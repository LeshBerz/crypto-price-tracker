// Планировщик (F6, D10) на FakeClock: время двигает тест, настоящих таймеров нет.
import type { Database } from '../../src/db/database.ts';
import type { MarketDataProvider, QuotesResult } from '../../src/market-data/provider.ts';
import { SyncScheduler } from '../../src/sync/scheduler.ts';
import { SyncService } from '../../src/sync/sync-service.ts';
import type { UnitOfWork } from '../../src/unit-of-work.ts';
import { createTestApp, SYNC_INTERVAL_MS, unconfiguredMarketData } from '../helpers/app.ts';
import { T0 } from '../helpers/db.ts';

const MINUTE = 60_000;
const EMPTY: QuotesResult = { quotes: [], missing: [], rejected: [], creditsUsed: 1 };

async function setup(getQuotes: MarketDataProvider['getQuotes'] = () => Promise.resolve(EMPTY)) {
  const marketData = { ...unconfiguredMarketData, getQuotes, getUsage: () => Promise.reject(new Error('no usage')) };
  const test = await createTestApp({ marketData });
  let broken = false;
  const uow: UnitOfWork = { run: (work) => (broken ? Promise.reject(new Error('db down')) : test.uow.run(work)) };
  // Сервис и планировщик — на одном UnitOfWork, который тест может «уронить»
  const sync = new SyncService({ uow, marketData, events: test.events, clock: test.clock, logger: test.logger });
  const scheduler = new SyncScheduler({
    sync,
    uow,
    clock: test.clock,
    logger: test.logger,
    intervalMs: SYNC_INTERVAL_MS,
  });
  return { ...test, sync, scheduler, breakDb: () => (broken = true) };
}

function insertCoin(db: Database, lastUpdatedAt: number | null) {
  db.prepare(
    "INSERT INTO cryptocurrencies (id, cmc_id, symbol, name, last_updated_at, created_at, updated_at) VALUES (1, 1, 'BTC', 'Bitcoin', ?, ?, ?)",
  ).run(lastUpdatedAt === null ? null : BigInt(lastUpdatedAt), BigInt(T0 - 60 * MINUTE), BigInt(T0 - 60 * MINUTE));
}

const runs = (db: Database) =>
  db.prepare('SELECT trigger, status, started_at FROM sync_runs ORDER BY id').all() as Record<string, unknown>[];

describe('SyncScheduler', () => {
  it('✅ цен нет → запуск startup сразу, дальше — schedule через интервал после завершения; stop отменяет ожидание', async () => {
    const { scheduler, clock, db } = await setup();
    expect(scheduler.state).toBe('stopped');
    await scheduler.start();
    await scheduler.start(); // повторный старт — no-op
    expect(scheduler.state).toBe('running');

    await clock.advance(0);
    expect(runs(db)).toEqual([{ trigger: 'startup', status: 'succeeded', started_at: T0 }]);

    await clock.advance(SYNC_INTERVAL_MS - 1);
    expect(runs(db)).toHaveLength(1);
    await clock.advance(1);
    expect(runs(db)[1]).toEqual({ trigger: 'schedule', status: 'succeeded', started_at: T0 + SYNC_INTERVAL_MS });

    await scheduler.stop();
    expect(scheduler.state).toBe('stopped');
    expect(clock.pendingSleeps).toBe(0);
    await clock.advance(10 * SYNC_INTERVAL_MS);
    expect(runs(db)).toHaveLength(2);
  });

  it('✅ цены свежие → первый запуск через остаток интервала: частые рестарты не тратят квоту', async () => {
    const { scheduler, clock, db } = await setup();
    insertCoin(db, T0 - 2 * MINUTE);
    await scheduler.start();

    await clock.advance(3 * MINUTE - 1);
    expect(runs(db)).toEqual([]);
    await clock.advance(1);
    expect(runs(db)).toEqual([{ trigger: 'schedule', status: 'succeeded', started_at: T0 + 3 * MINUTE }]);
    await scheduler.stop();
  });

  it('✅ цены устарели → startup сразу; зависший running прошлого процесса → interrupted', async () => {
    const { scheduler, clock, db, logs } = await setup();
    insertCoin(db, T0 - SYNC_INTERVAL_MS);
    db.prepare("INSERT INTO sync_runs (trigger, status, started_at) VALUES ('schedule', 'running', ?)").run(
      BigInt(T0 - 60 * MINUTE),
    );

    await scheduler.start();
    await clock.advance(0);
    expect(runs(db)).toEqual([
      { trigger: 'schedule', status: 'interrupted', started_at: T0 - 60 * MINUTE },
      { trigger: 'startup', status: 'succeeded', started_at: T0 },
    ]);
    expect(logs().find((entry) => entry.msg === 'sync runs marked interrupted')).toMatchObject({ count: 1 });
    await scheduler.stop();
  });

  it('✅ идёт ручной запуск → тик пропущен без ошибки, следующий — по расписанию', async () => {
    let release!: () => void;
    const { scheduler, sync, clock, db, logs } = await setup(
      () => new Promise((resolve) => (release = () => resolve(EMPTY))),
    );
    insertCoin(db, T0 - MINUTE);
    await scheduler.start();
    const manual = await sync.start('manual');

    await clock.advance(4 * MINUTE);
    expect(logs().some((entry) => entry.msg === 'scheduled sync skipped: already running')).toBe(true);
    release();
    await manual.finished;

    await clock.advance(SYNC_INTERVAL_MS);
    release();
    await sync.idle();
    expect(runs(db).map((run) => run.trigger)).toEqual(['manual', 'schedule']);
    await scheduler.stop();
  });

  it('❌ запуск не стартовал (БД недоступна) → ошибка в логе, цикл планировщика жив', async () => {
    const { scheduler, clock, logs, breakDb } = await setup();
    await scheduler.start();
    breakDb();
    await clock.advance(0);
    expect(logs().some((entry) => entry.msg === 'scheduled sync failed to start' && entry.level === 'error')).toBe(
      true,
    );
    expect(clock.pendingSleeps).toBe(1);
    await scheduler.stop();
  });
});
