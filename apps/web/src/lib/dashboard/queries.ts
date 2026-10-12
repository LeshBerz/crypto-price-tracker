// Три запроса дашборда (ADR 0017): цены, мини-графики и список монет ради признака паузы — и фоновое
// перечитывание данных всех экранов по событиям потока.
import { queryOptions, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { components } from '@/generated/api-types';
import type { BffClient } from '@/lib/bff-client';
import type { Interval, Period } from '@/lib/coin/intervals';
import { aggregatesQuery, coinKeys, coinQuery, historyQuery } from '@/lib/coin/queries';

export type LatestPriceList = components['schemas']['LatestPriceList'];
export type LatestPriceListItem = components['schemas']['LatestPriceListItem'];
export type SparklineList = components['schemas']['SparklineList'];
export type CryptocurrencyList = components['schemas']['CryptocurrencyList'];
export type SparklineWindow = SparklineList['window'];

export const dashboardKeys = {
  prices: ['prices'] as const,
  sparklinesAll: ['sparklines'] as const,
  sparklines: (window: SparklineWindow) => ['sparklines', window] as const,
  coins: ['cryptocurrencies'] as const,
};

/** background — запрос без действия пользователя: BFF не продлевает срок бездействия сессии */
export function pricesQuery(client: BffClient, background = false) {
  return queryOptions({
    queryKey: dashboardKeys.prices,
    queryFn: ({ signal }) => client.get('/api/v1/prices', { signal, background }),
  });
}

export function sparklinesQuery(client: BffClient, window: SparklineWindow, background = false) {
  return queryOptions({
    queryKey: dashboardKeys.sparklines(window),
    queryFn: ({ signal }) => client.get('/api/v1/prices/sparklines', { query: { window }, signal, background }),
  });
}

export function coinsQuery(client: BffClient, background = false) {
  return queryOptions({
    queryKey: dashboardKeys.coins,
    queryFn: ({ signal }) => client.get('/api/v1/cryptocurrencies', { signal, background }),
  });
}

export type RefreshTarget = 'prices' | 'sparklines' | 'coins' | 'coin' | 'aggregates' | 'history';

/** Всё, что показывают экраны: перечитывается после переподключения потока */
export const ALL_TARGETS: readonly RefreshTarget[] = ['prices', 'sparklines', 'coins', 'coin', 'aggregates', 'history'];

/**
 * Фоновый перезапрос идёт всегда (staleTime: 0) и один раз (retry: false): повтор обеспечит следующее событие
 * потока или его переподключение. Встроенный повтор к тому же ждёт, пока вкладка станет видимой, — ошибка
 * не попала бы в состояние запроса, и баннер «нет связи с API» не появился бы.
 */
const BACKGROUND = { staleTime: 0, retry: false } as const;

/** Запросы цели: префикс ключа и фоновый запрос по полному ключу */
const TARGETS: Record<
  RefreshTarget,
  { prefix: QueryKey; fetch: (queryClient: QueryClient, client: BffClient, key: QueryKey) => Promise<unknown> }
> = {
  prices: {
    prefix: dashboardKeys.prices,
    fetch: (queryClient, client) => queryClient.fetchQuery({ ...pricesQuery(client, true), ...BACKGROUND }),
  },
  coins: {
    prefix: dashboardKeys.coins,
    fetch: (queryClient, client) => queryClient.fetchQuery({ ...coinsQuery(client, true), ...BACKGROUND }),
  },
  sparklines: {
    prefix: dashboardKeys.sparklinesAll,
    fetch: (queryClient, client, key) =>
      queryClient.fetchQuery({ ...sparklinesQuery(client, key[1] as SparklineWindow, true), ...BACKGROUND }),
  },
  coin: {
    prefix: coinKeys.detailAll,
    fetch: (queryClient, client, key) =>
      queryClient.fetchQuery({ ...coinQuery(client, key[1] as number, true), ...BACKGROUND }),
  },
  aggregates: {
    prefix: coinKeys.aggregatesAll,
    fetch: (queryClient, client, key) =>
      queryClient.fetchQuery({
        ...aggregatesQuery(client, key[1] as number, key[2] as Interval, key[3] as Period, true),
        ...BACKGROUND,
      }),
  },
  history: {
    prefix: coinKeys.historyAll,
    // Перечитывается только первая страница: пропущенные точки лежат в её начале, а догружать заново все
    // открытые страницы — это запрос на каждую. Остальные страницы пользователь догрузит кнопкой
    fetch: (queryClient, client, key) =>
      queryClient.fetchInfiniteQuery({ ...historyQuery(client, key[1] as number, true), ...BACKGROUND, pages: 1 }),
  },
};

/**
 * Перечитывает данные по событию потока — фоновым запросом. `invalidateQueries` здесь не подходит: он запускает
 * обычный `queryFn` запроса, и BFF продлил бы сессию; открытая вкладка тогда не вышла бы по бездействию никогда.
 * `fetchQuery` выполняет запрос с признаком фона и кладёт результат (или ошибку) в тот же ключ кэша.
 *
 * Поток один на вкладку и работает на всех экранах, поэтому запрос уходит только за данными, которые сейчас
 * на экране (у запроса есть наблюдатель). Остальное помечается устаревшим и перечитается при открытии экрана.
 * `probe` — запрос цен, даже если их никто не показывает: по его ответу видна причина отказа потока
 * (401 уводит на страницу входа).
 */
export function refreshInBackground(
  queryClient: QueryClient,
  client: BffClient,
  targets: readonly RefreshTarget[],
  { probe = false }: { probe?: boolean } = {},
): Promise<void> {
  const fetches: Promise<unknown>[] = [];
  for (const target of new Set(targets)) {
    const { prefix, fetch } = TARGETS[target];
    for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
      if (query.getObserversCount() > 0) {
        fetches.push(fetch(queryClient, client, query.queryKey));
      } else {
        void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' });
      }
    }
  }
  if (probe && fetches.length === 0) fetches.push(TARGETS.prices.fetch(queryClient, client, dashboardKeys.prices));
  // Ошибка остаётся в состоянии запроса: экран показывает её баннером, а не необработанным отказом промиса
  return Promise.allSettled(fetches).then(() => undefined);
}
