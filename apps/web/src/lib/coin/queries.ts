// Три запроса карточки монеты: сама монета, агрегаты для графика и сводки, история сырых точек.
import { infiniteQueryOptions, queryOptions, type InfiniteData } from '@tanstack/react-query';
import type { components } from '@/generated/api-types';
import type { BffClient } from '@/lib/bff-client';
import { periodFrom, type Interval, type Period } from './intervals';

export type Cryptocurrency = components['schemas']['Cryptocurrency'];
export type PriceAggregates = components['schemas']['PriceAggregates'];
export type PriceBucket = components['schemas']['PriceBucket'];
export type AggregateStats = components['schemas']['AggregateStats'];
export type PriceHistoryPage = components['schemas']['PriceHistoryPage'];
export type PricePoint = components['schemas']['PricePoint'];
export type PriceHistory = InfiniteData<PriceHistoryPage, string | null>;

/** Корни ключей разные, чтобы поиск по префиксу находил запросы одного вида, а не все запросы монеты */
export const coinKeys = {
  detailAll: ['coin'] as const,
  detail: (id: number) => ['coin', id] as const,
  aggregatesAll: ['coin-aggregates'] as const,
  aggregatesOf: (id: number) => ['coin-aggregates', id] as const,
  aggregates: (id: number, interval: Interval, period: Period) => ['coin-aggregates', id, interval, period] as const,
  historyAll: ['coin-history'] as const,
  history: (id: number) => ['coin-history', id] as const,
};

export function coinQuery(client: BffClient, id: number, background = false) {
  return queryOptions({
    queryKey: coinKeys.detail(id),
    queryFn: ({ signal }) => client.get('/api/v1/cryptocurrencies/{id}', { params: { id }, signal, background }),
  });
}

/**
 * Начало периода считается в момент запроса и в ключ не входит: ключ остаётся постоянным, а повторный запрос
 * сдвигает окно к текущему времени. `to` не передаётся — api подставляет текущий момент.
 */
export function aggregatesQuery(
  client: BffClient,
  id: number,
  interval: Interval,
  period: Period,
  background = false,
  now: () => number = Date.now,
) {
  return queryOptions({
    queryKey: coinKeys.aggregates(id, interval, period),
    queryFn: ({ signal }) =>
      client.get('/api/v1/cryptocurrencies/{id}/prices/aggregates', {
        params: { id },
        query: { interval, from: periodFrom(now(), interval, period) },
        signal,
        background,
      }),
  });
}

export const HISTORY_PAGE_SIZE = 25;

/** История — от новых к старым. Параметр страницы — непрозрачный курсор api; у первой страницы его нет */
export function historyQuery(client: BffClient, id: number, background = false) {
  return infiniteQueryOptions({
    queryKey: coinKeys.history(id),
    queryFn: ({ pageParam, signal }) =>
      client.get('/api/v1/cryptocurrencies/{id}/prices', {
        params: { id },
        query: { limit: HISTORY_PAGE_SIZE, cursor: pageParam ?? undefined },
        signal,
        background,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: PriceHistoryPage) => last.nextCursor,
  });
}

/**
 * Страницы истории одной таблицей. Точка, сохранённая между запросами страниц, может попасть в поток событий
 * и в ответ api одновременно: дубли отбрасываются по времени котировки — оно уникально в пределах монеты.
 */
export function mergeHistoryPages(pages: readonly PriceHistoryPage[]): PricePoint[] {
  const seen = new Set<string>();
  const points: PricePoint[] = [];
  for (const page of pages) {
    for (const point of page.items) {
      if (seen.has(point.sourceUpdatedAt)) continue;
      seen.add(point.sourceUpdatedAt);
      points.push(point);
    }
  }
  return points;
}
