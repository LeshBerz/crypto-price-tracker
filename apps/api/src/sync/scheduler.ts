// Планировщик синхронизации (ADR 0015 §4, F6, D10): цепочка ожиданий, а не setInterval. Следующий запуск
// планируется после завершения текущего, поэтому долгий ответ CMC не даёт наложения и «долга» таймеров.
// Аналог в Nest — @Interval/@Cron из @nestjs/schedule, только с явным стартом и остановкой.
import type { Clock } from '../common/clock.ts';
import type { Logger } from '../common/logger.ts';
import type { UnitOfWork } from '../unit-of-work.ts';
import { SyncAlreadyRunningError, type SyncService } from './sync-service.ts';
import type { SyncTrigger } from './sync-run-repository.ts';

export type SchedulerDeps = { sync: SyncService; uow: UnitOfWork; clock: Clock; logger: Logger; intervalMs: number };

export class SyncScheduler {
  private readonly deps: SchedulerDeps;
  /** Ожидание следующего запуска можно прервать — аналог сохранённого таймера для clearTimeout (C6) */
  private controller: AbortController | null = null;
  private loop: Promise<void> = Promise.resolve();

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  get state(): 'running' | 'stopped' {
    return this.controller ? 'running' : 'stopped';
  }

  /**
   * Запуски, оставшиеся running после падения процесса, помечаются interrupted — иначе индекс «один running»
   * не дал бы стартовать никогда. Первый запуск — сразу, если цены старше интервала (или их нет),
   * иначе через остаток интервала: частые рестарты не тратят квоту CMC.
   */
  async start(): Promise<void> {
    if (this.controller) return;
    const { uow, clock, logger, intervalMs } = this.deps;
    const now = clock.now();
    const { interrupted, lastUpdatedAt } = await uow.run(async (repos) => ({
      interrupted: await repos.syncRuns.markInterrupted(now),
      lastUpdatedAt: await repos.cryptocurrencies.lastUpdatedAt(),
    }));
    if (interrupted > 0) logger.warn('sync runs marked interrupted', { count: interrupted });

    const age = lastUpdatedAt === null ? Infinity : now - lastUpdatedAt;
    const delayMs = age >= intervalMs ? 0 : intervalMs - age;
    logger.info('scheduler started', { intervalMs, firstRunInMs: delayMs });
    this.controller = new AbortController();
    this.loop = this.cycle(delayMs, delayMs === 0 ? 'startup' : 'schedule', this.controller.signal);
  }

  /** Отменяет ожидание следующего запуска. Идущий запуск не трогает: его дожидается или прерывает shutdown */
  async stop(): Promise<void> {
    this.controller?.abort(new Error('scheduler stopped'));
    this.controller = null;
    await this.loop;
  }

  private async cycle(firstDelayMs: number, firstTrigger: SyncTrigger, signal: AbortSignal): Promise<void> {
    const { sync, clock, logger, intervalMs } = this.deps;
    let delayMs = firstDelayMs;
    let trigger = firstTrigger;
    while (!signal.aborted) {
      try {
        await clock.sleep(delayMs, signal);
      } catch {
        return;
      }
      try {
        await sync.run(trigger);
      } catch (error) {
        // Идёт ручной запуск — этот тик пропускаем. Остальное (БД) логируем: цикл планировщика падать не должен
        if (error instanceof SyncAlreadyRunningError) logger.info('scheduled sync skipped: already running');
        else logger.error('scheduled sync failed to start', { error });
      }
      delayMs = intervalMs;
      trigger = 'schedule';
    }
  }
}
