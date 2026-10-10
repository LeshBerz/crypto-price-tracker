// HTTP-хендлеры чтения цен (F3–F5): вход провалидирован роутером по спеке, здесь — вызов сервиса,
// маппинг в контракт и перевод доменных ошибок в RFC 9457. Аналог в Nest — контроллер + ExceptionFilter.
import type { Clock } from '../common/clock.ts';
import { HttpProblem, validationProblem } from '../http/problem.ts';
import type { Handlers } from '../http/router.ts';
import { summarize, toStats } from './aggregates.ts';
import { toLatestPrice } from './latest-price.ts';
import { PriceQueryError, type PriceQueryService } from './price-query-service.ts';

export type PriceHandlersDeps = { prices: PriceQueryService; clock: Clock; syncIntervalMs: number };

type PriceOperation = 'listLatestPrices' | 'listSparklines' | 'listPriceHistory' | 'getPriceAggregates';

const iso = (ms: number) => new Date(ms).toISOString();
/** Формат date-time уже проверен роутером по спеке (RFC 3339 с зоной), поэтому Date.parse здесь однозначен */
const ms = (text: string | undefined) => (text === undefined ? undefined : Date.parse(text));

export function priceHandlers(deps: PriceHandlersDeps): Pick<Handlers, PriceOperation> {
  const { prices } = deps;

  return {
    listLatestPrices: async () => {
      const { lastSync, items } = await prices.latest();
      const now = deps.clock.now();
      return {
        status: 200,
        body: {
          currency: 'USD',
          lastSync: lastSync && {
            id: lastSync.id,
            status: lastSync.status,
            finishedAt: lastSync.finishedAt === null ? null : iso(lastSync.finishedAt),
          },
          items: items.map(({ coin, latest }) => ({
            cryptocurrencyId: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            latest: latest && toLatestPrice(latest, now, deps.syncIntervalMs),
          })),
        },
      };
    },

    listSparklines: async ({ input }) => {
      const window = input.query?.window ?? '24h';
      const { interval, items } = await prices.sparklines(window);
      return {
        status: 200,
        body: {
          currency: 'USD',
          window,
          interval,
          items: items.map((item) => ({
            cryptocurrencyId: item.cryptocurrencyId,
            points: item.points.map((point) => ({ bucketStart: iso(point.bucketStart), close: point.close })),
          })),
        },
      };
    },

    listPriceHistory: async ({ input }) => {
      const { from, to, limit, cursor } = input.query ?? {};
      const page = await translate(() =>
        prices.history(input.path.id, { from: ms(from), to: ms(to), limit: limit ?? 100, cursor }),
      );
      return {
        status: 200,
        body: {
          cryptocurrencyId: input.path.id,
          currency: 'USD',
          items: page.items.map((point) => ({
            price: point.price,
            sourceUpdatedAt: iso(point.sourceUpdatedAt),
            fetchedAt: iso(point.fetchedAt),
          })),
          nextCursor: page.nextCursor,
        },
      };
    },

    getPriceAggregates: async ({ input }) => {
      const { interval } = input.query;
      const result = await translate(() =>
        prices.aggregates(input.path.id, { interval, from: Date.parse(input.query.from), to: ms(input.query.to) }),
      );
      return {
        status: 200,
        body: {
          cryptocurrencyId: input.path.id,
          currency: 'USD',
          interval,
          from: iso(result.from),
          to: iso(result.to),
          summary: summarize(result.buckets),
          buckets: result.buckets.map((bucket) => ({ bucketStart: iso(bucket.bucketStart), stats: toStats(bucket) })),
        },
      };
    },
  };
}

/** Какой параметр запроса виноват в доменной ошибке — для поля errors[].path в Problem Details */
const QUERY_PATH = {
  'invalid-cursor': '/query/cursor',
  'empty-period': '/query/from',
  'too-many-buckets': '/query/from',
};

async function translate<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof PriceQueryError)) throw error;
    if (error.kind === 'not-found') throw new HttpProblem(404, 'not-found', { detail: error.message });
    throw validationProblem([{ path: QUERY_PATH[error.kind], message: error.message }]);
  }
}
