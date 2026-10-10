// PriceQueryService (ADR 0015 §1): чтение цен (F3–F5) — актуальные, история, агрегаты, мини-графики.
// Читает только из БД: ответ не зависит от доступности CMC и не тратит квоту (D5). Про HTTP не знает.
import type { Clock } from '../common/clock.ts';
import { decodeCursor, encodeCursor } from '../common/cursor.ts';
import type { SyncRunRecord } from '../sync/sync-run-repository.ts';
import type { Repositories, UnitOfWork } from '../unit-of-work.ts';
import type { CryptocurrencyRecord } from '../watchlist/cryptocurrency-repository.ts';
import {
  bucketStartOf,
  INTERVALS,
  MAX_BUCKETS,
  SPARKLINES,
  type AggregateInterval,
  type SparklineWindow,
} from './aggregates.ts';
import { DAY_MS } from './latest-price.ts';
import type { CloseRow, LatestPriceRow, PriceBucketRow, PricePointRow } from './price-repository.ts';

export type PriceQueryErrorKind = 'not-found' | 'invalid-cursor' | 'empty-period' | 'too-many-buckets';

export class PriceQueryError extends Error {
  override name = 'PriceQueryError';
  readonly kind: PriceQueryErrorKind;

  constructor(kind: PriceQueryErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export type LatestPrices = {
  lastSync: SyncRunRecord | null;
  items: { coin: CryptocurrencyRecord; latest: LatestPriceRow | null }[];
};
export type HistoryPage = { items: PricePointRow[]; nextCursor: string | null };
export type Aggregates = { from: number; to: number; buckets: PriceBucketRow[] };
export type Sparklines = {
  interval: '1h' | '4h';
  items: { cryptocurrencyId: number; points: CloseRow[] }[];
};

export type HistoryParams = { from?: number; to?: number; limit: number; cursor?: string };
export type AggregateParams = { interval: AggregateInterval; from: number; to?: number };

export type PriceQueryDeps = { uow: UnitOfWork; clock: Clock };

export class PriceQueryService {
  private readonly deps: PriceQueryDeps;

  constructor(deps: PriceQueryDeps) {
    this.deps = deps;
  }

  latest(): Promise<LatestPrices> {
    const dayAgo = this.deps.clock.now() - DAY_MS;
    return this.deps.uow.run(async (repos) => {
      const coins = await repos.cryptocurrencies.list();
      const prices = await repos.prices.latestFor(
        coins.map((coin) => coin.id),
        dayAgo,
      );
      const byCoin = new Map(prices.map((row) => [row.cryptocurrencyId, row]));
      return {
        lastSync: await repos.syncRuns.latest(),
        items: coins.map((coin) => ({ coin, latest: byCoin.get(coin.id) ?? null })),
      };
    });
  }

  async history(cryptocurrencyId: number, params: HistoryParams): Promise<HistoryPage> {
    const { limit } = params;
    const from = params.from ?? 0;
    const to = params.to ?? this.deps.clock.now();
    if (from >= to) throw new PriceQueryError('empty-period', 'Period is empty: from must be earlier than to');
    const before = params.cursor === undefined ? null : decodeCursor(params.cursor);
    if (params.cursor !== undefined && before === null) {
      throw new PriceQueryError('invalid-cursor', 'Cursor is not valid: use nextCursor from the previous page as is');
    }

    // Берём на одну строку больше: её наличие и есть признак следующей страницы, без отдельного COUNT
    const rows = await this.deps.uow.run(async (repos) => {
      await this.require(repos, cryptocurrencyId);
      return repos.prices.history(cryptocurrencyId, { from, to, limit: limit + 1, before });
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor({ at: last.fetchedAt, id: last.id }) : null,
    };
  }

  async aggregates(cryptocurrencyId: number, params: AggregateParams): Promise<Aggregates> {
    const grid = INTERVALS[params.interval];
    const { from } = params;
    const to = params.to ?? this.deps.clock.now();
    if (from >= to) throw new PriceQueryError('empty-period', 'Period is empty: from must be earlier than to');
    if ((to - from) / grid.sizeMs > MAX_BUCKETS) {
      throw new PriceQueryError(
        'too-many-buckets',
        `Period holds more than ${MAX_BUCKETS} buckets of ${params.interval}: narrow the period or use a larger interval`,
      );
    }
    const buckets = await this.deps.uow.run(async (repos) => {
      await this.require(repos, cryptocurrencyId);
      return repos.prices.buckets(cryptocurrencyId, { ...grid, from, to });
    });
    return { from, to, buckets };
  }

  sparklines(window: SparklineWindow): Promise<Sparklines> {
    const { interval, points } = SPARKLINES[window];
    const grid = INTERVALS[interval];
    // Окно заканчивается текущим (ещё не закрытым) бакетом: последняя точка графика — самая свежая цена
    const to = bucketStartOf(this.deps.clock.now(), grid) + grid.sizeMs;
    const from = to - points * grid.sizeMs;
    return this.deps.uow.run(async (repos) => {
      const coins = await repos.cryptocurrencies.list();
      const closes = await repos.prices.closes(
        coins.map((coin) => coin.id),
        { ...grid, from, to },
      );
      const byCoin = Map.groupBy(closes, (row) => row.cryptocurrencyId);
      return {
        interval,
        items: coins.map((coin) => ({ cryptocurrencyId: coin.id, points: byCoin.get(coin.id) ?? [] })),
      };
    });
  }

  private async require(repos: Repositories, id: number): Promise<CryptocurrencyRecord> {
    const coin = await repos.cryptocurrencies.get(id);
    if (!coin) throw new PriceQueryError('not-found', `Cryptocurrency ${id} is not tracked`);
    return coin;
  }
}
