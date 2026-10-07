import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, sqlInt, type Database } from '../../src/db/database.ts';

describe('openDatabase', () => {
  let dir: string;
  let db: Database | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cpt-db-'));
  });
  afterEach(() => {
    db?.close();
    db = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  // Имя колонки результата не всегда совпадает с именем PRAGMA (busy_timeout → timeout), берём первое значение
  const pragma = (name: string) => Object.values(db?.prepare(`PRAGMA ${name}`).get() ?? {})[0];

  it('файловая БД: WAL, synchronous = NORMAL, foreign_keys = ON (ADR 0003)', () => {
    db = openDatabase(join(dir, 'test.db'));
    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('synchronous')).toBe(1); // 1 = NORMAL
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('busy_timeout')).toBe(5000);
  });

  it('таймаут блокировки настраивается', () => {
    db = openDatabase(':memory:', { busyTimeoutMs: 250 });
    expect(pragma('busy_timeout')).toBe(250);
  });

  it('не открывает файл в несуществующем каталоге', () => {
    expect(() => openDatabase(join(dir, 'нет', 'test.db'))).toThrow();
  });
});

describe('правило «целые параметры — BigInt» (ADR 0007)', () => {
  const db = openDatabase(':memory:');
  afterAll(() => db.close());

  it('JS number уходит в SQLite как REAL, и деление становится дробным', () => {
    expect(db.prepare('SELECT typeof(?) AS t, 7 / ? AS q').get(2, 2)).toEqual({ t: 'real', q: 3.5 });
  });

  it('BigInt уходит как INTEGER, деление целочисленное', () => {
    expect(db.prepare('SELECT typeof(?) AS t, 7 / ? AS q').get(2n, 2n)).toEqual({ t: 'integer', q: 3 });
  });

  it('sqlInt превращает безопасное целое в BigInt', () => {
    expect(sqlInt(3_600_000)).toBe(3_600_000n);
  });

  it.each([1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('sqlInt отклоняет %p', (value) => {
    expect(() => sqlInt(value)).toThrow(TypeError);
  });
});
