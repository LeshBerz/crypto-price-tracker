// Приложение для HTTP-тестов: настоящая SQLite :memory:, FakeClock, лог-шпион и настоящий ApiKeyAuthenticator
// с ключами TOKENS в БД (ADR 0009: БД не мокаем, внешний мир — фейки портов).
import { createApp, type AppDeps } from '../../src/app.ts';
import { ApiKeyAuthenticator } from '../../src/auth/api-key-authenticator.ts';
import { loadMigrations } from '../../src/db/migrations.ts';
import { SqliteUnitOfWork } from '../../src/db/unit-of-work.ts';
import { seedTestKeys } from './auth.ts';
import { createTestDb, MIGRATIONS_DIR } from './db.ts';
import { FakeClock } from './fake-clock.ts';
import { createSpyLogger } from './logger.ts';

export const SCHEMA_VERSION = Math.max(...loadMigrations(MIGRATIONS_DIR).map((m) => m.version));

export async function createTestApp(overrides: Partial<AppDeps> = {}) {
  const clock = new FakeClock();
  const { logger, entries } = createSpyLogger(clock);
  const db = createTestDb();
  const uow = new SqliteUnitOfWork(db);
  await seedTestKeys(uow);
  const app = createApp({
    db,
    schemaVersion: SCHEMA_VERSION,
    logger,
    clock,
    authenticator: new ApiKeyAuthenticator({ uow, clock }),
    ...overrides,
  });
  return { app, db, uow, clock, logs: entries };
}
