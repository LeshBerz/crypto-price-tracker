// Настоящая SQLite в памяти с реальными миграциями — своя на каждый тест (ADR 0009: БД не мокаем).
import { join } from 'node:path';
import { openDatabase, type Database } from '../../src/db/database.ts';
import { loadMigrations, migrate } from '../../src/db/migrations.ts';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
export const T0 = Date.UTC(2026, 9, 7, 12, 0, 0); // 07.10.2026 12:00 UTC

export function createTestDb(): Database {
  const db = openDatabase(':memory:');
  migrate(db, loadMigrations(MIGRATIONS_DIR), () => T0);
  return db;
}
