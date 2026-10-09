// SqliteCryptocurrencyRepository и SqlitePriceRepository на настоящей SQLite (ADR 0009).
import type { Database } from '../../src/db/database.ts';
import { SqliteCryptocurrencyRepository } from '../../src/db/repositories/cryptocurrencies.ts';
import { SqlitePriceRepository } from '../../src/db/repositories/prices.ts';
import { SqliteUnitOfWork } from '../../src/db/unit-of-work.ts';
import { createTestDb, T0 } from '../helpers/db.ts';

describe('репозитории watchlist и цен', () => {
  let db: Database;
  let uow: SqliteUnitOfWork;
  const price = (coin: number, value: string, fetchedAt: number) =>
    db
      .prepare(
        'INSERT INTO price_history (cryptocurrency_id, price, source_updated_at, fetched_at) VALUES (?, ?, ?, ?)',
      )
      .run(BigInt(coin), value, BigInt(fetchedAt), BigInt(fetchedAt));

  beforeEach(async () => {
    db = createTestDb();
    uow = new SqliteUnitOfWork(db);
    await uow.run(async ({ cryptocurrencies }) => {
      await cryptocurrencies.create({ cmcId: 1, symbol: 'BTC', name: 'Bitcoin', createdAt: T0 });
      await cryptocurrencies.create({ cmcId: 1027, symbol: 'ETH', name: 'Ethereum', createdAt: T0 });
    });
  });
  afterEach(() => db.close());

  it('findConflict: по символу или по cmc_id; без cmcId ищет только символ', async () => {
    await uow.run(async ({ cryptocurrencies }) => {
      expect((await cryptocurrencies.findConflict('BTC', undefined))?.id).toBe(1);
      expect((await cryptocurrencies.findConflict('XBT', 1027))?.id).toBe(2);
      expect(await cryptocurrencies.findConflict('XBT', undefined)).toBeNull();
      expect(await cryptocurrencies.count()).toBe(2);
    });
  });

  it('update без полей меняет только updated_at; несуществующий id → null', async () => {
    await uow.run(async ({ cryptocurrencies }) => {
      expect(await cryptocurrencies.update(1, {}, T0 + 1)).toMatchObject({
        name: 'Bitcoin',
        isPaused: false,
        updatedAt: T0 + 1,
      });
      expect(await cryptocurrencies.update(1, { isPaused: false }, T0 + 2)).toMatchObject({ isPaused: false });
      expect(await cryptocurrencies.update(99, { name: 'x' }, T0)).toBeNull();
    });
  });

  it('latestFor: последняя цена и цена «сутки назад» по каждой монете одним запросом', async () => {
    price(1, '10', T0);
    price(1, '11', T0 + 10);
    price(1, '12', T0 + 20);
    price(2, '5', T0 + 5);
    const rows = await uow.run(({ prices }) => prices.latestFor([2, 1, 3], T0 + 10));
    expect(rows).toEqual([
      { cryptocurrencyId: 1, price: '12', sourceUpdatedAt: T0 + 20, fetchedAt: T0 + 20, priceDayAgo: '11' },
      { cryptocurrencyId: 2, price: '5', sourceUpdatedAt: T0 + 5, fetchedAt: T0 + 5, priceDayAgo: '5' },
    ]);
  });

  it('latestFor: пустой список — без запроса; цены «сутки назад» нет — null', async () => {
    price(1, '10', T0 + 100);
    await uow.run(async ({ prices }) => {
      expect(await prices.latestFor([], T0)).toEqual([]);
      expect((await prices.latestFor([1], T0))[0]?.priceDayAgo).toBeNull();
    });
  });

  it('latestFor идёт по индексу (cryptocurrency_id, fetched_at), без полного сканирования истории', () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT l.id FROM price_history l WHERE l.cryptocurrency_id = 1 ORDER BY l.fetched_at DESC, l.id DESC LIMIT 1`,
      )
      .all() as { detail: string }[];
    const detail = plan.map((p) => p.detail).join(' | ');
    expect(detail).toMatch(/USING (COVERING )?INDEX price_history_coin_time/);
    // ORDER BY … LIMIT 1 читается с конца индекса, без сортировки во временном B-дереве
    expect(detail).not.toMatch(/TEMP B-TREE/);
  });

  it('❌ вне UnitOfWork.run — ошибка', async () => {
    const coins = new SqliteCryptocurrencyRepository(db);
    const prices = new SqlitePriceRepository(db);
    const message = /вне UnitOfWork.run/;
    await expect(coins.list()).rejects.toThrow(message);
    await expect(coins.get(1)).rejects.toThrow(message);
    await expect(coins.findConflict('BTC', 1)).rejects.toThrow(message);
    await expect(coins.count()).rejects.toThrow(message);
    await expect(coins.create({ cmcId: 5, symbol: 'X', name: 'X', createdAt: T0 })).rejects.toThrow(message);
    await expect(coins.update(1, {}, T0)).rejects.toThrow(message);
    await expect(coins.delete(1)).rejects.toThrow(message);
    await expect(prices.latestFor([1], T0)).rejects.toThrow(message);
  });
});
