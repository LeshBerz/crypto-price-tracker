// Liveness и readiness (бриф §4, ADR 0014). Liveness — «процесс жив и обрабатывает запросы»,
// readiness — «можно слать трафик»: БД отвечает, схема на нужной версии, нет остановки.
// CoinMarketCap в readiness не входит: при его падении сервис отдаёт сохранённые данные (F7).
import type { Database } from './db/database.ts';
import type { components } from './generated/api-types.ts';
import type { Handlers } from './http/router.ts';

export type Readiness = components['schemas']['Readiness'];
export type SchedulerState = Readiness['checks']['scheduler'];

/** Состояние процесса, которое ведут планировщик (B12) и координатор остановки (B14) */
export type Lifecycle = {
  isShuttingDown(): boolean;
  schedulerState(): SchedulerState;
  /** Время следующего запуска по расписанию, epoch ms; `null` — запуск идёт или планировщика нет */
  nextRunAt(): number | null;
};

export const staticLifecycle: Lifecycle = {
  isShuttingDown: () => false,
  schedulerState: () => 'disabled',
  nextRunAt: () => null,
};

export type ReadinessDeps = {
  db: Database;
  /** Версия последней миграции, которую знает этот код */
  schemaVersion: number;
  lifecycle: Lifecycle;
};

export function checkReadiness({ db, schemaVersion, lifecycle }: ReadinessDeps): Readiness {
  let database: 'ok' | 'fail' = 'ok';
  let migrations: 'ok' | 'fail' = 'fail';
  try {
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: unknown };
    if (row.version === schemaVersion) migrations = 'ok';
  } catch {
    // Закрытая или сломанная БД: запрос не выполнился
    database = 'fail';
  }
  const ready = database === 'ok' && migrations === 'ok' && !lifecycle.isShuttingDown();
  return {
    status: ready ? 'ok' : 'fail',
    checks: { database, migrations, scheduler: lifecycle.schedulerState() },
  };
}

export function healthHandlers(deps: ReadinessDeps): Pick<Handlers, 'getLiveness' | 'getReadiness'> {
  return {
    getLiveness: () => ({ status: 200, body: { status: 'ok' } }),
    getReadiness: () => {
      const readiness = checkReadiness(deps);
      // 503: балансировщик перестаёт слать трафик (при остановке — шаг 0 из ADR 0015)
      return readiness.status === 'ok' ? { status: 200, body: readiness } : { status: 503, body: readiness };
    },
  };
}
