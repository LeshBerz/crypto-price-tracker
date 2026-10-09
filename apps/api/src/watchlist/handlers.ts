// HTTP-хендлеры watchlist (F2): вход уже провалидирован роутером по спеке, здесь — вызов сервиса,
// маппинг в контракт (camelCase, ISO-время) и перевод доменных ошибок в RFC 9457.
// Аналог в Nest — контроллер + ExceptionFilter для доменных исключений.
import type { Clock } from '../common/clock.ts';
import type { Logger } from '../common/logger.ts';
import type { components } from '../generated/api-types.ts';
import { HttpProblem } from '../http/problem.ts';
import type { Handlers } from '../http/router.ts';
import { MarketDataError } from '../market-data/provider.ts';
import { toLatestPrice } from '../prices/latest-price.ts';
import { WatchlistError, type WatchlistItem, type WatchlistService } from './watchlist-service.ts';

type Cryptocurrency = components['schemas']['Cryptocurrency'];

/** Retry-After для 503, если CMC сам не подсказал: примерно столько CMC обычно восстанавливается после сбоя */
export const DEFAULT_RETRY_AFTER_S = 30;
const MAX_RETRY_AFTER_S = 60;

export type WatchlistHandlersDeps = { watchlist: WatchlistService; clock: Clock; syncIntervalMs: number };

type WatchlistOperation =
  | 'listCryptocurrencies'
  | 'createCryptocurrency'
  | 'getCryptocurrency'
  | 'updateCryptocurrency'
  | 'deleteCryptocurrency';

export function watchlistHandlers(deps: WatchlistHandlersDeps): Pick<Handlers, WatchlistOperation> {
  const { watchlist } = deps;
  const dto = (item: WatchlistItem): Cryptocurrency => toCryptocurrency(item, deps.clock.now(), deps.syncIntervalMs);

  return {
    listCryptocurrencies: async () => ({ status: 200, body: { items: (await watchlist.list()).map(dto) } }),

    createCryptocurrency: async ({ input, log }) => {
      const item = await translate(() => watchlist.create(input.body.symbol, input.body.cmcId), log);
      return {
        status: 201,
        body: dto(item),
        headers: { Location: `/api/v1/cryptocurrencies/${item.coin.id}` },
      };
    },

    getCryptocurrency: async ({ input, log }) => ({
      status: 200,
      body: dto(await translate(() => watchlist.get(input.path.id), log)),
    }),

    updateCryptocurrency: async ({ input, log }) => ({
      status: 200,
      body: dto(await translate(() => watchlist.update(input.path.id, input.body), log)),
    }),

    deleteCryptocurrency: async ({ input, log }) => {
      await translate(() => watchlist.delete(input.path.id), log);
      return { status: 204 };
    },
  };
}

export function toCryptocurrency(item: WatchlistItem, now: number, syncIntervalMs: number): Cryptocurrency {
  const { coin, latest } = item;
  return {
    id: coin.id,
    cmcId: coin.cmcId,
    symbol: coin.symbol,
    name: coin.name,
    isPaused: coin.isPaused,
    lastUpdatedAt: coin.lastUpdatedAt === null ? null : new Date(coin.lastUpdatedAt).toISOString(),
    createdAt: new Date(coin.createdAt).toISOString(),
    updatedAt: new Date(coin.updatedAt).toISOString(),
    latestPrice: latest === null ? null : toLatestPrice(latest, now, syncIntervalMs),
  };
}

/** Доменная ошибка → HttpProblem; остальное летит дальше и станет 500 в errorHandler */
async function translate<T>(work: () => Promise<T>, log: Logger) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WatchlistError) {
      if (error.kind === 'not-found') throw new HttpProblem(404, 'not-found', { detail: error.message });
      if (error.kind === 'already-tracked') {
        throw new HttpProblem(409, 'already-tracked', { detail: error.message, conflictingId: error.conflictingId });
      }
      throw new HttpProblem(422, 'watchlist-limit-reached', { detail: error.message });
    }
    if (error instanceof MarketDataError) throw fromMarketData(error, log);
    throw error;
  }
}

function fromMarketData(error: MarketDataError, log: Logger): HttpProblem {
  if (error.code === 'CMC_UNKNOWN_SYMBOL') return new HttpProblem(422, 'unknown-symbol', { detail: error.message });
  if (error.code === 'CMC_AUTH') {
    // Неверный ключ CMC — наша конфигурация, а не проблема клиента: детали только в лог (C4)
    log.error('CMC rejected our API key', { code: error.code, error });
    return new HttpProblem(500, 'internal-error', { detail: 'Unexpected error. See logs by requestId', cause: error });
  }
  // Без CMC символ не проверить, а добавлять непроверенное нельзя (ADR 0014): честно просим повторить позже
  const retryAfter =
    error.retryAfterMs === undefined
      ? DEFAULT_RETRY_AFTER_S
      : Math.min(MAX_RETRY_AFTER_S, Math.max(1, Math.ceil(error.retryAfterMs / 1000)));
  return new HttpProblem(503, 'upstream-unavailable', {
    detail: `CoinMarketCap is unavailable (${error.code}). Try again later`,
    headers: { 'Retry-After': String(retryAfter) },
    cause: error,
  });
}
