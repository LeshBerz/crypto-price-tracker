// Запросы панели оператора: журнал синхронизаций, состояние CoinMarketCap и готовность сервиса.
// Список монет панель берёт у дашборда (`coinsQuery`): один ключ кэша — одно состояние watchlist на вкладку.
import { infiniteQueryOptions, queryOptions, type InfiniteData } from '@tanstack/react-query';
import type { components } from '@/generated/api-types';
import { BffError, type BffClient } from '@/lib/bff-client';

export type SyncRun = components['schemas']['SyncRun'];
export type SyncRunPage = components['schemas']['SyncRunPage'];
export type SyncRuns = InfiniteData<SyncRunPage, string | null>;
export type CmcStatus = components['schemas']['CmcStatus'];
export type Readiness = components['schemas']['Readiness'];

export const operatorKeys = {
  syncRuns: ['sync-runs'] as const,
  cmc: ['system-cmc'] as const,
  readiness: ['health-ready'] as const,
};

export const SYNC_RUNS_PAGE_SIZE = 25;

/** Журнал запусков — от новых к старым, страницы по курсору api (ADR 0014) */
export function syncRunsQuery(client: BffClient, background = false) {
  return infiniteQueryOptions({
    queryKey: operatorKeys.syncRuns,
    queryFn: ({ pageParam, signal }) =>
      client.get('/api/v1/sync-runs', {
        query: { limit: SYNC_RUNS_PAGE_SIZE, cursor: pageParam ?? undefined },
        signal,
        background,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SyncRunPage) => last.nextCursor,
  });
}

export function cmcStatusQuery(client: BffClient, background = false) {
  return queryOptions({
    queryKey: operatorKeys.cmc,
    queryFn: ({ signal }) => client.get('/api/v1/system/cmc', { signal, background }),
  });
}

const CHECK_VALUES = new Set(['ok', 'fail']);
const SCHEDULER_VALUES = new Set(['running', 'stopped', 'disabled']);

/** Тело `/health/ready` приходит и с 200, и с 503 — форма проверяется, прежде чем попасть на экран */
export function isReadiness(body: unknown): body is Readiness {
  if (typeof body !== 'object' || body === null) return false;
  const { status, checks } = body as { status?: unknown; checks?: unknown };
  if (!CHECK_VALUES.has(status as string) || typeof checks !== 'object' || checks === null) return false;
  const { database, migrations, scheduler } = checks as Record<string, unknown>;
  return (
    CHECK_VALUES.has(database as string) &&
    CHECK_VALUES.has(migrations as string) &&
    SCHEDULER_VALUES.has(scheduler as string)
  );
}

/**
 * Готовность api. «Не готов» (503 с составом проверок) — это данные, а не ошибка запроса: экран показывает,
 * какая проверка не прошла. Ошибкой остаётся только отсутствие ответа api.
 */
export function readinessQuery(client: BffClient, background = false) {
  return queryOptions({
    queryKey: operatorKeys.readiness,
    queryFn: async ({ signal }): Promise<Readiness> => {
      try {
        return await client.get('/health/ready', { signal, background });
      } catch (error) {
        if (error instanceof BffError && error.status === 503 && isReadiness(error.body)) return error.body;
        throw error;
      }
    },
  });
}

/** Страницы журнала одной таблицей. Запуск, добавленный из ответа на ручной старт, придёт и в ответе api */
export function mergeRunPages(pages: readonly SyncRunPage[]): SyncRun[] {
  const seen = new Set<number>();
  const runs: SyncRun[] = [];
  for (const page of pages) {
    for (const run of page.items) {
      if (seen.has(run.id)) continue;
      seen.add(run.id);
      runs.push(run);
    }
  }
  return runs;
}

/**
 * Запуск из ответа api — в начало журнала (или на место записи с тем же id). Журнал ещё не загружен —
 * возвращается как есть: первый ответ api принесёт этот запуск сам.
 */
export function upsertRun(data: SyncRuns | undefined, run: SyncRun): SyncRuns | undefined {
  const [first, ...rest] = data?.pages ?? [];
  if (!data || !first) return data;
  if (data.pages.some((page) => page.items.some((item) => item.id === run.id))) {
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === run.id ? run : item)),
    }));
    return { ...data, pages };
  }
  return { ...data, pages: [{ ...first, items: [run, ...first.items] }, ...rest] };
}
