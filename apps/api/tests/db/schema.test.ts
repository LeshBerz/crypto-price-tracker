// Инварианты схемы 0001_core (ADR 0013): БД — последняя линия обороны после валидатора.
import type { Database } from '../../src/db/database.ts';
import { createTestDb, T0 } from '../helpers/db.ts';

describe('схема 0001_core', () => {
  let db: Database;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => db.close());

  const addCoin = (symbol = 'BTC', cmcId = 1) =>
    Number(
      db
        .prepare('INSERT INTO cryptocurrencies (cmc_id, symbol, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(BigInt(cmcId), symbol, 'Bitcoin', BigInt(T0), BigInt(T0)).lastInsertRowid,
    );
  const addPrice = (coinId: number, price: string, sourceUpdatedAt = T0) =>
    db
      .prepare(
        `INSERT INTO price_history (cryptocurrency_id, price, source_updated_at, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (cryptocurrency_id, source_updated_at) DO NOTHING`,
      )
      .run(BigInt(coinId), price, BigInt(sourceUpdatedAt), BigInt(T0));
  const startRun = () =>
    db.prepare("INSERT INTO sync_runs (trigger, status, started_at) VALUES ('schedule', 'running', ?)").run(BigInt(T0));

  describe('монеты (D-1)', () => {
    it('✅ принимает символ A-Z0-9', () => {
      expect(addCoin('BTC')).toBe(1);
    });

    it.each(['btc', 'BTC-USD', '', 'A'.repeat(16)])('❌ отклоняет символ %p', (symbol) => {
      expect(() => addCoin(symbol)).toThrow(/CHECK constraint failed/);
    });

    it('❌ отклоняет дубль символа и cmc_id', () => {
      addCoin('BTC', 1);
      expect(() => addCoin('BTC', 2)).toThrow(/UNIQUE/);
      expect(() => addCoin('XBT', 1)).toThrow(/UNIQUE/);
    });
  });

  describe('история цен (D-2, ADR 0006)', () => {
    it('✅ хранит точную десятичную строку, price_num — для сортировки', () => {
      const id = addCoin();
      addPrice(id, '67123.451234567891');
      expect(db.prepare('SELECT price, typeof(price_num) AS t FROM price_history').get()).toEqual({
        price: '67123.451234567891',
        t: 'real',
      });
    });

    it.each(['1.2e-9', '-5', '0', '0.000', '1.2.3', 'abc', '12.', '.5', ' 1'])('❌ отклоняет цену %p', (price) => {
      const id = addCoin();
      expect(() => addPrice(id, price)).toThrow(/CHECK constraint failed/);
    });

    it('✅ повтор той же котировки CMC не создаёт дубль (идемпотентность синхронизации)', () => {
      const id = addCoin();
      expect(addPrice(id, '100').changes).toBe(1);
      expect(addPrice(id, '100').changes).toBe(0);
    });

    it('STRICT: целое поле не принимает дробь и текст', () => {
      const id = addCoin();
      const insert = db.prepare(
        'INSERT INTO price_history (cryptocurrency_id, price, source_updated_at, fetched_at) VALUES (?, ?, ?, ?)',
      );
      expect(() => insert.run(BigInt(id), '1', 1.5, BigInt(T0))).toThrow(/cannot store REAL value in INTEGER column/);
      expect(() => insert.run(BigInt(id), '1', 'abc', BigInt(T0))).toThrow(/cannot store TEXT value in INTEGER column/);
    });

    it('удаление монеты каскадно удаляет историю и свёртки', () => {
      const id = addCoin();
      addPrice(id, '100');
      db.prepare("INSERT INTO price_rollups_1h VALUES (?, ?, 1, '100', '100', '100', '100', 100.0)").run(
        BigInt(id),
        BigInt(T0),
      );
      db.prepare('DELETE FROM cryptocurrencies WHERE id = ?').run(BigInt(id));
      expect(
        db.prepare('SELECT (SELECT count(*) FROM price_history) + (SELECT count(*) FROM price_rollups_1h) AS n').get(),
      ).toEqual({ n: 0 });
    });
  });

  describe('запуски синхронизации (D10)', () => {
    it('❌ второй running отклоняется частичным уникальным индексом', () => {
      startRun();
      expect(() => startRun()).toThrow(/UNIQUE constraint failed/);
    });

    it('✅ после завершения первого запуска можно начать новый', () => {
      startRun();
      db.prepare("UPDATE sync_runs SET status = 'succeeded', finished_at = ?").run(BigInt(T0 + 1000));
      expect(() => startRun()).not.toThrow();
    });

    it('❌ завершённый статус без finished_at нарушает CHECK', () => {
      expect(() =>
        db
          .prepare("INSERT INTO sync_runs (trigger, status, started_at) VALUES ('manual', 'failed', ?)")
          .run(BigInt(T0)),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  it('целостность: integrity_check = ok, нарушений внешних ключей нет', () => {
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
