// Три запроса дашборда (ADR 0017): цены, мини-графики и список монет ради признака паузы.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { components } from '@/generated/api-types';
import type { BffClient } from '@/lib/bff-client';

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

export type RefreshTarget = 'prices' | 'sparklines' | 'coins';

/**
 * Фоновый перезапрос идёт всегда (staleTime: 0) и один раз (retry: false): повтор обеспечит следующее событие
 * потока или его переподключение. Встроенный повтор к тому же ждёт, пока вкладка станет видимой, — ошибка
 * не попала бы в состояние запроса, и баннер «нет связи с API» не появился бы.
 */
const BACKGROUND = { staleTime: 0, retry: false } as const;

/**
 * Перечитывает данные по событию потока — фоновым запросом. `invalidateQueries` здесь не подходит: он запускает
 * обычный `queryFn` запроса, и BFF продлил бы сессию; открытая вкладка тогда не вышла бы по бездействию никогда.
 * `fetchQuery` выполняет запрос с признаком фона и кладёт результат (или ошибку) в тот же ключ кэша.
 */
export function refreshInBackground(
  queryClient: QueryClient,
  client: BffClient,
  targets: readonly RefreshTarget[],
): Promise<void> {
  const fetches: Promise<unknown>[] = [];
  if (targets.includes('prices')) fetches.push(queryClient.fetchQuery({ ...pricesQuery(client, true), ...BACKGROUND }));
  if (targets.includes('coins')) fetches.push(queryClient.fetchQuery({ ...coinsQuery(client, true), ...BACKGROUND }));
  if (targets.includes('sparklines')) {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: dashboardKeys.sparklinesAll })) {
      const window = query.queryKey[1] as SparklineWindow;
      if (query.getObserversCount() > 0) {
        fetches.push(queryClient.fetchQuery({ ...sparklinesQuery(client, window, true), ...BACKGROUND }));
      } else {
        // Окно, которого нет на экране, только помечается устаревшим — перечитается при переключении
        void queryClient.invalidateQueries({ queryKey: query.queryKey, refetchType: 'none' });
      }
    }
  }
  // Ошибка остаётся в состоянии запроса: экран показывает её баннером, а не необработанным отказом промиса
  return Promise.allSettled(fetches).then(() => undefined);
}
