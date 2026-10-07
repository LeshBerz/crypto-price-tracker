import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Database } from '../../src/db/database.ts';
import { checksumOf, loadMigrations, migrate, MigrationError, type Migration } from '../../src/db/migrations.ts';
import { MIGRATIONS_DIR, T0 } from '../helpers/db.ts';

const now = () => T0;
const m = (version: number, sql: string, name = `m${version}`): Migration => ({
  version,
  name,
  sql,
  checksum: checksumOf(sql),
});

const tables = (db: Database) =>
  (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );

describe('migrate', () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
  });
  afterEach(() => db.close());

  it('✅ применяет 0001_core: таблицы ядра ТЗ и запись в schema_migrations', () => {
    const result = migrate(db, loadMigrations(MIGRATIONS_DIR), now);

    expect(result).toEqual({ applied: [1], current: 1 });
    expect(tables(db)).toEqual(
      expect.arrayContaining(['cryptocurrencies', 'price_history', 'price_rollups_1h', 'sync_runs', 'api_keys']),
    );
    expect(db.prepare('SELECT version, name, applied_at FROM schema_migrations').all()).toEqual([
      { version: 1, name: 'core', applied_at: T0 },
    ]);
  });

  it('✅ повторный запуск ничего не применяет (идемпотентность при рестарте)', () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    migrate(db, migrations, now);
    expect(migrate(db, migrations, now)).toEqual({ applied: [], current: 1 });
  });

  it('✅ применяет только новые миграции', () => {
    migrate(db, [m(1, 'CREATE TABLE a (x INTEGER) STRICT')], now);
    const result = migrate(
      db,
      [m(1, 'CREATE TABLE a (x INTEGER) STRICT'), m(2, 'CREATE TABLE b (y INTEGER) STRICT')],
      now,
    );
    expect(result.applied).toEqual([2]);
    expect(tables(db)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('пустой список миграций — версия схемы 0', () => {
    expect(migrate(db, [], now)).toEqual({ applied: [], current: 0 });
  });

  it('❌ изменённая после применения миграция — отказ старта', () => {
    migrate(db, [m(1, 'CREATE TABLE a (x INTEGER) STRICT')], now);
    expect(() => migrate(db, [m(1, 'CREATE TABLE a (x INTEGER, y TEXT) STRICT')], now)).toThrow(
      /изменена после применения/,
    );
  });

  it('❌ применённая миграция без файла — отказ старта', () => {
    migrate(db, [m(1, 'CREATE TABLE a (x INTEGER) STRICT'), m(2, 'CREATE TABLE b (x INTEGER) STRICT')], now);
    expect(() => migrate(db, [m(1, 'CREATE TABLE a (x INTEGER) STRICT')], now)).toThrow(/файла нет/);
  });

  it('❌ ошибка в миграции откатывает её целиком, предыдущие остаются', () => {
    const broken = 'CREATE TABLE c (x INTEGER) STRICT; INSERT INTO нет_такой VALUES (1);';
    const migrations = [m(1, 'CREATE TABLE a (x INTEGER) STRICT'), m(2, broken)];

    expect(() => migrate(db, migrations, now)).toThrow(MigrationError);
    expect(tables(db)).toContain('a');
    expect(tables(db)).not.toContain('c'); // DDL в SQLite транзакционен
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
  });
});

describe('loadMigrations', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cpt-mig-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('✅ читает файлы по порядку версий и игнорирует не-SQL', () => {
    writeFileSync(join(dir, '0002_second.sql'), 'SELECT 2;');
    writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;');
    writeFileSync(join(dir, 'README.md'), '#');
    expect(loadMigrations(dir).map((x) => [x.version, x.name])).toEqual([
      [1, 'first'],
      [2, 'second'],
    ]);
  });

  it('❌ пропуск версии', () => {
    writeFileSync(join(dir, '0001_a.sql'), 'SELECT 1;');
    writeFileSync(join(dir, '0003_c.sql'), 'SELECT 3;');
    expect(() => loadMigrations(dir)).toThrow(/подряд/);
  });

  it.each(['1_a.sql', '0001-a.sql', '0001_A.sql'])('❌ имя %s не по формату NNNN_name.sql', (file) => {
    writeFileSync(join(dir, file), 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow(/формату/);
  });
});

describe('checksumOf', () => {
  it('не зависит от CRLF/LF: checkout на Windows не ломает старт', () => {
    expect(checksumOf('SELECT 1;\r\nSELECT 2;\r\n')).toBe(checksumOf('SELECT 1;\nSELECT 2;\n'));
  });

  it('меняется при изменении текста', () => {
    expect(checksumOf('SELECT 1;')).not.toBe(checksumOf('SELECT 2;'));
  });
});
