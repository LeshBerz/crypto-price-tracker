// Приложение для HTTP-тестов: настоящая SQLite :memory:, FakeClock, лог-шпион и настоящий ApiKeyAuthenticator
// с ключами TOKENS в БД (ADR 0009: БД не мокаем, внешний мир — фейки портов или HTTP-стаб CMC).
import { createApp, type AppDeps } from '../../src/app.ts';
import { ApiKeyAuthenticator } from '../../src/auth/api-key-authenticator.ts';
import { loadMigrations } from '../../src/db/migrations.ts';
import { SqliteUnitOfWork } from '../../src/db/unit-of-work.ts';
import { InProcessEventBus, type AppEvent } from '../../src/events/event-bus.ts';
import type { MarketDataProvider } from '../../src/market-data/provider.ts';
import { SyncService } from '../../src/sync/sync-service.ts';
import { seedTestKeys } from './auth.ts';
import { createTestDb, MIGRATIONS_DIR } from './db.ts';
import { FakeClock } from './fake-clock.ts';
import { createSpyLogger } from './logger.ts';

export const SCHEMA_VERSION = Math.max(...loadMigrations(MIGRATIONS_DIR).map((m) => m.version));
export const SYNC_INTERVAL_MS = 300_000;

/** CMC по умолчанию не настроен: тест, которому он нужен, передаёт адаптер против стаба */
export const unconfiguredMarketData: MarketDataProvider = {
  resolveSymbol: () => Promise.reject(new Error('CMC не настроен в этом тесте')),
  getQuotes: () => Promise.reject(new Error('CMC не настроен в этом тесте')),
  getUsage: () => Promise.reject(new Error('CMC не настроен в этом тесте')),
};

export async function createTestApp(overrides: Partial<AppDeps> = {}) {
  const clock = new FakeClock();
  const { logger, entries } = createSpyLogger(clock);
  const db = createTestDb();
  const uow = new SqliteUnitOfWork(db);
  await seedTestKeys(uow);
  const events = new InProcessEventBus(logger);
  const published: AppEvent[] = [];
  for (const type of ['watchlist.changed', 'price.updated', 'sync.finished'] as const) {
    events.subscribe(type, (event) => published.push(event));
  }
  const marketData = overrides.marketData ?? unconfiguredMarketData;
  const sync = overrides.sync ?? new SyncService({ uow, marketData, events, clock, logger });
  const app = createApp({
    db,
    schemaVersion: SCHEMA_VERSION,
    logger,
    clock,
    authenticator: new ApiKeyAuthenticator({ uow, clock }),
    uow,
    marketData,
    events,
    sync,
    syncIntervalMs: SYNC_INTERVAL_MS,
    ...overrides,
  });
  return { app, db, uow, clock, events, published, logs: entries, sync, logger };
}
