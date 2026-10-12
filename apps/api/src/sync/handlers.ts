// HTTP-хендлеры синхронизации и состояния CMC (F6, F7): вызов сервиса, маппинг в контракт, доменные ошибки → RFC 9457.
import type { SchedulerState } from '../health.ts';
import { HttpProblem, validationProblem } from '../http/problem.ts';
import type { Handlers } from '../http/router.ts';
import { SyncAlreadyRunningError, SyncQueryError, toSyncRun, type SyncService } from './sync-service.ts';

/** Расписание на момент запроса (ADR 0017, 1D): состояние и время — от планировщика, интервал — из конфига */
export type SyncSchedule = { state: SchedulerState; intervalMs: number; nextRunAt: number | null };
export type SyncHandlersDeps = { sync: SyncService; schedule: () => SyncSchedule };

type SyncOperation = 'listSyncRuns' | 'triggerSyncRun' | 'getSyncRun' | 'getCmcStatus';

const iso = (ms: number) => new Date(ms).toISOString();

export function syncHandlers({ sync, schedule }: SyncHandlersDeps): Pick<Handlers, SyncOperation> {
  return {
    listSyncRuns: async ({ input }) => {
      const page = await translate(() => sync.page(input.query?.limit ?? 100, input.query?.cursor));
      return { status: 200, body: { items: page.items.map(toSyncRun), nextCursor: page.nextCursor } };
    },

    // 202, а не 201: запись запуска создана, но работа (запрос в CMC) ещё идёт — итог смотреть по Location
    triggerSyncRun: async () => {
      const { run } = await translate(() => sync.start('manual'));
      return { status: 202, body: toSyncRun(run), headers: { Location: `/api/v1/sync-runs/${run.id}` } };
    },

    getSyncRun: async ({ input }) => ({
      status: 200,
      body: toSyncRun(await translate(() => sync.get(input.path.id))),
    }),

    getCmcStatus: async () => {
      const { lastSuccess, lastFailure, quota } = await sync.cmcStatus();
      const { state, intervalMs, nextRunAt } = schedule();
      return {
        status: 200,
        body: {
          lastSuccessAt: lastSuccess?.finishedAt ? iso(lastSuccess.finishedAt) : null,
          lastError:
            lastFailure?.finishedAt && lastFailure.errorCode
              ? {
                  code: lastFailure.errorCode,
                  message: lastFailure.errorMessage ?? '',
                  at: iso(lastFailure.finishedAt),
                }
              : null,
          quota: quota && { ...quota, fetchedAt: iso(quota.fetchedAt) },
          schedule: { state, intervalMs, nextRunAt: nextRunAt === null ? null : iso(nextRunAt) },
        },
      };
    },
  };
}

async function translate<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      throw new HttpProblem(409, 'sync-already-running', {
        detail: error.message,
        conflictingId: error.conflictingId,
      });
    }
    if (!(error instanceof SyncQueryError)) throw error;
    if (error.kind === 'not-found') throw new HttpProblem(404, 'not-found', { detail: error.message });
    throw validationProblem([{ path: '/query/cursor', message: error.message }]);
  }
}
