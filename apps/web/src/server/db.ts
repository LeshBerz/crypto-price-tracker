// БД web (ADR 0016): отдельный файл web.db на node:sqlite, raw SQL. Пользователи и сессии не живут в apps/api.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AUTH_0001 } from './migrations/0001-auth';
import { SESSION_ID_0002 } from './migrations/0002-session-id';

export type Database = DatabaseSync;

export type Migration = { version: number; name: string; sql: string };

/**
 * Миграции — строки в коде, а не файлы: сборка Next (output: standalone) переносит только то, что импортировано,
 * и SQL-файл рядом с сервером мог бы не попасть в образ.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'auth', sql: AUTH_0001 },
  { version: 2, name: 'session_id', sql: SESSION_ID_0002 },
];

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  // Явно: без него ON DELETE CASCADE у сессий молча не работает
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/**
 * Несколько записей как одно целое: смена роли и отзыв сессий либо происходят вместе, либо не происходят.
 * node:sqlite синхронный, поэтому `work` обязан быть синхронным: await внутри отпустил бы Event Loop
 * посреди открытой транзакции.
 */
export function inTransaction<T>(db: Database, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Только вперёд, каждая миграция — в своей транзакции. Ошибка → откат и остановка старта */
export function migrate(db: Database, now: number, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT`);
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => Number(row.version)),
  );
  const done: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        now,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`web migration ${migration.version}_${migration.name} failed`, { cause: error });
    }
    done.push(migration.version);
  }
  return done;
}
