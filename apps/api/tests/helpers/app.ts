// Приложение для HTTP-тестов: настоящая SQLite :memory:, FakeClock, лог-шпион, фейковый Authenticator (ADR 0009).
import { createApp, type AppDeps } from '../../src/app.ts';
import { loadMigrations } from '../../src/db/migrations.ts';
import { fakeAuthenticator } from './auth.ts';
import { createTestDb, MIGRATIONS_DIR } from './db.ts';
import { FakeClock } from './fake-clock.ts';
import { createSpyLogger } from './logger.ts';

export const SCHEMA_VERSION = Math.max(...loadMigrations(MIGRATIONS_DIR).map((m) => m.version));

export function createTestApp(overrides: Partial<AppDeps> = {}) {
  const clock = new FakeClock();
  const { logger, entries } = createSpyLogger(clock);
  const db = createTestDb();
  const app = createApp({
    db,
    schemaVersion: SCHEMA_VERSION,
    logger,
    clock,
    authenticator: fakeAuthenticator,
    ...overrides,
  });
  return { app, db, clock, logs: entries };
}
