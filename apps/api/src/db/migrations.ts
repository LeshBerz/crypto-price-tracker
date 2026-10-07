// Раннер миграций (ADR 0013): raw SQL-файлы, только вперёд, контрольная сумма, транзакция на миграцию.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './database.ts';

export type Migration = { version: number; name: string; sql: string; checksum: string };

export type AppliedMigration = { version: number; name: string; checksum: string; applied_at: number };

export class MigrationError extends Error {
  override name = 'MigrationError';
}

const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/**
 * SHA-256 текста миграции. Переводы строк нормализуются: иначе checkout с CRLF на Windows
 * дал бы другую сумму, и сервис отказался бы стартовать на чужой машине.
 */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function loadMigrations(dir: string): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = FILE_NAME.exec(file);
      if (!match) throw new MigrationError(`Имя миграции ${file} не соответствует формату NNNN_name.sql`);
      const sql = readFileSync(join(dir, file), 'utf8');
      return { version: Number(match[1]), name: String(match[2]), sql, checksum: checksumOf(sql) };
    })
    .sort((a, b) => a.version - b.version);

  migrations.forEach((m, index) => {
    if (m.version !== index + 1) {
      throw new MigrationError(
        `Версии миграций должны идти подряд с 0001: ожидалась ${index + 1}, найдена ${m.version}`,
      );
    }
  });
  return migrations;
}

export type MigrateResult = { applied: number[]; current: number };

export function migrate(db: Database, migrations: readonly Migration[], now: () => number): MigrateResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    checksum   TEXT    NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT`);

  const rows = db
    .prepare('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version')
    .all() as AppliedMigration[];
  const known = new Map(migrations.map((m) => [m.version, m]));

  // История не переписывается: применённую миграцию нельзя ни изменить, ни удалить
  for (const row of rows) {
    const file = known.get(row.version);
    if (!file) {
      throw new MigrationError(`Миграция ${row.version} (${row.name}) применена к БД, но её файла нет`);
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError(
        `Миграция ${row.version} (${row.name}) изменена после применения. Не правьте применённые миграции — создайте новую`,
      );
    }
  }

  const appliedVersions = new Set(rows.map((r) => r.version));
  const insert = db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)');
  const applied: number[] = [];

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      insert.run(BigInt(migration.version), migration.name, migration.checksum, BigInt(now()));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new MigrationError(`Миграция ${migration.version} (${migration.name}) не применена: ${String(error)}`, {
        cause: error,
      });
    }
    applied.push(migration.version);
  }

  return { applied, current: migrations.at(-1)?.version ?? 0 };
}
