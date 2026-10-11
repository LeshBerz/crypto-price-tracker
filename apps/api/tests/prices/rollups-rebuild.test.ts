// rollups:rebuild (ADR 0007): свёртка — производный кэш, поэтому пересборка из price_history обязана дать
// ровно то, что записала синхронизация. Данные пишет настоящий SyncService, БД — SQLite :memory:.
import type { Database } from '../../src/db/database.ts';
import type { MarketDataProvider, Quote } from '../../src/market-data/provider.ts';
import { createTestApp, unconfiguredMarketData } from '../helpers/app.ts';
import { T0 } from '../helpers/db.ts';

const MINUTE = 60_000;
const ROLLUPS = 'SELECT * FROM price_rollups_1h ORDER BY cryptocurrency_id, bucket_start';
const rows = (db: Database, sql: string) => db.prepare(sql).all() as Record<string, unknown>[];

function insertCoin(db: Database, id: number, symbol: string) {
  db.prepare(
    'INSERT INTO cryptocurrencies (id, cmc_id, symbol, name, is_paused, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
  ).run(BigInt(id), BigInt(id), symbol, `${symbol} coin`, BigInt(T0), BigInt(T0));
}

/** Три часа синхронизаций каждые 20 минут по двум монетам: в каждом часе несколько точек с разными ценами */
async function seed() {
  let next: Quote[] = [];
  const marketData: MarketDataProvider = {
    ...unconfiguredMarketData,
    getQuotes: () => Promise.resolve({ quotes: next, missing: [], rejected: [], creditsUsed: 1 }),
    getUsage: () => Promise.reject(new Error('квота в этом тесте не нужна')),
  };
  const context = await createTestApp({ marketData });
  insertCoin(context.db, 1, 'BTC');
  insertCoin(context.db, 2, 'ETH');
  const prices = [
    '67000.5',
    '67250.123456789012',
    '66900',
    '67100.000000000001',
    '68000',
    '67999.99',
    '66000.1',
    '67500',
    '67400',
  ];
  for (const [step, price] of prices.entries()) {
    const at = context.clock.now();
    next = [
      { cmcId: 1, price, sourceUpdatedAt: at },
      { cmcId: 2, price: `${2400 + step * 7}.${step}5`, sourceUpdatedAt: at },
    ];
    expect((await context.sync.run('schedule')).status).toBe('succeeded');
    await context.clock.advance(20 * MINUTE);
  }
  return context;
}

describe('PriceRepository.rebuildRollups', () => {
  it('пересборка совпадает с тем, что записала синхронизация', async () => {
    const { db, uow } = await seed();
    const written = rows(db, ROLLUPS);
    expect(written).toHaveLength(6);
    expect(written.every((row) => Number(row['points']) === 3)).toBe(true);

    expect(await uow.run((repos) => repos.prices.rebuildRollups())).toBe(6);
    expect(rows(db, ROLLUPS)).toEqual(written);
  });

  it('восстанавливает удалённые и испорченные свёртки, лишние убирает', async () => {
    const { db, uow } = await seed();
    const written = rows(db, ROLLUPS);
    const hour = BigInt(T0 - (T0 % 3_600_000));

    db.prepare('DELETE FROM price_rollups_1h WHERE cryptocurrency_id = 1 AND bucket_start = ?').run(hour);
    db.prepare(
      "UPDATE price_rollups_1h SET close = '1', max = '999999', points = 99 WHERE cryptocurrency_id = 2",
    ).run();
    // Свёртка часа, в котором нет ни одной сырой точки
    db.prepare(
      "INSERT INTO price_rollups_1h (cryptocurrency_id, bucket_start, points, open, close, min, max, sum_num) VALUES (1, ?, 1, '1', '1', '1', '1', 1.0)",
    ).run(hour - 36_000_000n);
    expect(rows(db, ROLLUPS)).not.toEqual(written);

    await uow.run((repos) => repos.prices.rebuildRollups());
    expect(rows(db, ROLLUPS)).toEqual(written);
  });

  it('пустая история — свёрток нет, результат 0', async () => {
    const { db, uow } = await createTestApp();
    expect(await uow.run((repos) => repos.prices.rebuildRollups())).toBe(0);
    expect(rows(db, ROLLUPS)).toEqual([]);
  });
});
