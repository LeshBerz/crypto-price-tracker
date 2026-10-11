// Координатор остановки (C6, ADR 0015 §5): по SIGTERM/SIGINT закрывает всё в порядке, проверенном прототипом.
// Зависимости — узкие интерфейсы, сигналы и exit внедряются: порядок шагов проверяется unit-тестом без процесса.
// Аналог в Nest — app.enableShutdownHooks() + OnApplicationShutdown, только порядок здесь задан явно.
import type { Clock } from './common/clock.ts';
import type { Logger } from './common/logger.ts';

export const GRACE_MS = 10_000;
export const WATCHDOG_MS = 15_000;
export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

export type ShutdownDeps = {
  server: {
    close(callback: (error?: Error) => void): unknown;
    closeIdleConnections(): void;
    closeAllConnections(): void;
  };
  scheduler: { stop(): Promise<void> };
  sync: { idle(): Promise<void>; abort(reason: Error): void };
  sse: { closeAll(): void };
  db: { close(): void };
  clock: Clock;
  logger: Logger;
  /** process.exit в server.ts, шпион в тестах */
  exit: (code: number) => void;
  graceMs?: number;
  watchdogMs?: number;
};

/** Источник сигналов: process в server.ts, EventEmitter в тестах */
export type SignalSource = { on(signal: string, listener: () => void): unknown };

const TIMEOUT = Symbol('timeout');

export class ShutdownCoordinator {
  private readonly deps: ShutdownDeps;
  private stopping: Promise<void> | null = null;

  constructor(deps: ShutdownDeps) {
    this.deps = deps;
  }

  /** Readiness читает этот флаг: с первого сигнала /health/ready отвечает 503 */
  isShuttingDown(): boolean {
    return this.stopping !== null;
  }

  listen(source: SignalSource, signals: readonly string[] = SHUTDOWN_SIGNALS): void {
    for (const signal of signals) source.on(signal, () => void this.shutdown(signal));
  }

  /** Шаг 0: повторный сигнал не запускает остановку второй раз, а получает тот же промис */
  shutdown(signal: string): Promise<void> {
    if (this.stopping) {
      this.deps.logger.info('shutdown already in progress', { signal });
      return this.stopping;
    }
    this.stopping = this.run(signal);
    return this.stopping;
  }

  private async run(signal: string): Promise<void> {
    const { server, scheduler, sync, sse, db, clock, logger, exit } = this.deps;
    const graceMs = this.deps.graceMs ?? GRACE_MS;
    const startedAt = clock.now();
    logger.info('shutdown started', { signal, graceMs });

    // Шаг 8 заводится первым: если любой шаг ниже зависнет, процесс всё равно завершится
    const timers = new AbortController();
    let exited = false;
    const finish = (code: number) => {
      if (exited) return;
      exited = true;
      timers.abort(new Error('shutdown finished'));
      exit(code);
    };
    void clock.sleep(this.deps.watchdogMs ?? WATCHDOG_MS, timers.signal).then(
      () => {
        logger.error('shutdown watchdog fired: forcing exit');
        finish(1);
      },
      () => undefined,
    );
    // Одно окно grace на шаги 5 и 6: вместе они не дольше graceMs
    const grace = clock.sleep(graceMs, timers.signal).then(
      () => TIMEOUT,
      () => TIMEOUT,
    );

    try {
      // 1. Следующий запуск по расписанию не начнётся. Не ждём здесь: цикл может быть внутри идущей синхронизации
      const schedulerStopped = scheduler.stop();
      // 2. Новые соединения не принимаются, текущие запросы дорабатывают
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      // 3. Иначе server.close() ждал бы SSE-потоки вечно
      sse.closeAll();
      // 4. Keep-alive сокеты без запросов: без этого — до 5 с ожидания keepAliveTimeout
      server.closeIdleConnections();

      // 5. Идущая синхронизация: ждём, по истечении grace прерываем запрос к CMC — запуск получит interrupted
      if ((await Promise.race([sync.idle(), grace])) === TIMEOUT) {
        logger.warn('sync did not finish in time: aborting');
        sync.abort(new Error('shutdown'));
        await sync.idle();
      }
      await schedulerStopped;

      // 6. Соединения, пережившие grace, рвём принудительно
      server.closeIdleConnections();
      if ((await Promise.race([closed, grace])) === TIMEOUT) {
        logger.warn('connections still open after grace: closing all');
        server.closeAllConnections();
        await closed;
      }

      // 7. Закрытие БД делает чекпоинт WAL. Логгер пишет синхронно — сбрасывать нечего
      db.close();
      logger.info('shutdown complete', { durationMs: clock.now() - startedAt });
      finish(0);
    } catch (error) {
      logger.error('shutdown failed', { error });
      finish(1);
    }
  }
}
