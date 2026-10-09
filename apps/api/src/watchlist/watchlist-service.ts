// WatchlistService (ADR 0015 §1): CRUD отслеживаемых монет (F2). Знает только порты — UnitOfWork, MarketDataProvider,
// EventBus, Clock; про HTTP не знает: ошибки — доменные, в Problem Details их переводят хендлеры.
// Аналог в Nest — @Injectable() WatchlistService, только зависимости переданы конструктору явно.
import type { Clock } from '../common/clock.ts';
import { createEvent, type EventBus } from '../events/event-bus.ts';
import type { MarketDataProvider } from '../market-data/provider.ts';
import type { LatestPriceRow } from '../prices/price-repository.ts';
import { DAY_MS } from '../prices/latest-price.ts';
import type { Repositories, UnitOfWork } from '../unit-of-work.ts';
import type { CryptocurrencyPatch, CryptocurrencyRecord } from './cryptocurrency-repository.ts';

/** Лимит watchlist: 100 монет = 1 кредит CMC на синхронизацию (ADR 0007, maxItems в контракте) */
export const WATCHLIST_LIMIT = 100;

export type WatchlistItem = { coin: CryptocurrencyRecord; latest: LatestPriceRow | null };

export type WatchlistErrorKind = 'not-found' | 'already-tracked' | 'limit-reached';

export class WatchlistError extends Error {
  override name = 'WatchlistError';
  readonly kind: WatchlistErrorKind;
  /** Для already-tracked — id уже отслеживаемой монеты */
  readonly conflictingId: number | undefined;

  constructor(kind: WatchlistErrorKind, message: string, conflictingId?: number) {
    super(message);
    this.kind = kind;
    this.conflictingId = conflictingId;
  }
}

export type WatchlistDeps = { uow: UnitOfWork; marketData: MarketDataProvider; events: EventBus; clock: Clock };

export class WatchlistService {
  private readonly deps: WatchlistDeps;

  constructor(deps: WatchlistDeps) {
    this.deps = deps;
  }

  list(): Promise<WatchlistItem[]> {
    return this.deps.uow.run(async (repos) => this.withPrices(repos, await repos.cryptocurrencies.list()));
  }

  get(id: number): Promise<WatchlistItem> {
    return this.deps.uow.run(async (repos) => {
      const [item] = await this.withPrices(repos, [await this.require(repos, id)]);
      return item as WatchlistItem;
    });
  }

  /**
   * Добавление: дешёвые проверки → CMC вне транзакции → повторная проверка и вставка в транзакции → событие.
   * Первая проверка экономит кредит CMC на заведомо отклонённом запросе; повторная закрывает гонку двух
   * одновременных POST (между ними прошёл сетевой запрос). Сеть внутри транзакции держала бы соединение (ADR 0015).
   */
  async create(symbol: string, cmcId?: number, signal?: AbortSignal): Promise<WatchlistItem> {
    const { uow, marketData, clock } = this.deps;
    await uow.run((repos) => this.checkCanAdd(repos, symbol, cmcId));
    const resolved = await marketData.resolveSymbol(symbol, cmcId, signal);
    const coin = await uow.run(async (repos) => {
      await this.checkCanAdd(repos, resolved.symbol, resolved.cmcId);
      return repos.cryptocurrencies.create({ ...resolved, createdAt: clock.now() });
    });
    this.publish(coin.id, 'added');
    return { coin, latest: null };
  }

  async update(id: number, patch: CryptocurrencyPatch): Promise<WatchlistItem> {
    const name = patch.name?.trim();
    const item = await this.deps.uow.run(async (repos) => {
      const coin = await repos.cryptocurrencies.update(id, { ...patch, name }, this.deps.clock.now());
      if (coin === null) throw notFound(id);
      const [withPrice] = await this.withPrices(repos, [coin]);
      return withPrice as WatchlistItem;
    });
    this.publish(id, 'updated');
    return item;
  }

  async delete(id: number): Promise<void> {
    const deleted = await this.deps.uow.run(({ cryptocurrencies }) => cryptocurrencies.delete(id));
    if (!deleted) throw notFound(id);
    this.publish(id, 'removed');
  }

  private async checkCanAdd(repos: Repositories, symbol: string, cmcId: number | undefined): Promise<void> {
    const existing = await repos.cryptocurrencies.findConflict(symbol, cmcId);
    if (existing !== null) {
      throw new WatchlistError('already-tracked', `${existing.symbol} is already tracked`, existing.id);
    }
    if ((await repos.cryptocurrencies.count()) >= WATCHLIST_LIMIT) {
      throw new WatchlistError('limit-reached', `Watchlist is limited to ${WATCHLIST_LIMIT} cryptocurrencies`);
    }
  }

  private async require(repos: Repositories, id: number): Promise<CryptocurrencyRecord> {
    const coin = await repos.cryptocurrencies.get(id);
    if (coin === null) throw notFound(id);
    return coin;
  }

  private async withPrices(repos: Repositories, coins: CryptocurrencyRecord[]): Promise<WatchlistItem[]> {
    const rows = await repos.prices.latestFor(
      coins.map((c) => c.id),
      this.deps.clock.now() - DAY_MS,
    );
    const byId = new Map(rows.map((row) => [row.cryptocurrencyId, row]));
    return coins.map((coin) => ({ coin, latest: byId.get(coin.id) ?? null }));
  }

  /** Строго после COMMIT: uow.run уже вернул результат (ADR 0015 §3) */
  private publish(cryptocurrencyId: number, change: 'added' | 'updated' | 'removed'): void {
    this.deps.events.publish(createEvent('watchlist.changed', { cryptocurrencyId, change }, this.deps.clock));
  }
}

function notFound(id: number): WatchlistError {
  return new WatchlistError('not-found', `Cryptocurrency ${id} not found`);
}
