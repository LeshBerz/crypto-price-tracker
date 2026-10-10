// Адаптер CryptocurrencyRepository на node:sqlite: raw SQL (C1), snake_case в БД ↔ camelCase в коде (ADR 0014).
import type {
  CryptocurrencyPatch,
  CryptocurrencyRecord,
  CryptocurrencyRepository,
  NewCryptocurrency,
} from '../../watchlist/cryptocurrency-repository.ts';
import { sqlInt, type Database } from '../database.ts';
import { assertInTransaction } from '../transaction.ts';

type CryptocurrencyRow = {
  id: number;
  cmc_id: number;
  symbol: string;
  name: string;
  is_paused: number;
  last_updated_at: number | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS = 'id, cmc_id, symbol, name, is_paused, last_updated_at, created_at, updated_at';

function toRecord(row: CryptocurrencyRow): CryptocurrencyRecord {
  return {
    id: row.id,
    cmcId: row.cmc_id,
    symbol: row.symbol,
    name: row.name,
    isPaused: row.is_paused === 1,
    lastUpdatedAt: row.last_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteCryptocurrencyRepository implements CryptocurrencyRepository {
  private readonly db: Database;
  private readonly statements;

  constructor(db: Database) {
    this.db = db;
    this.statements = {
      list: db.prepare(`SELECT ${COLUMNS} FROM cryptocurrencies ORDER BY symbol`),
      listActive: db.prepare(`SELECT ${COLUMNS} FROM cryptocurrencies WHERE is_paused = 0 ORDER BY symbol`),
      markUpdated: db.prepare(
        'UPDATE cryptocurrencies SET last_updated_at = ? WHERE id IN (SELECT value FROM json_each(?))',
      ),
      lastUpdatedAt: db.prepare('SELECT max(last_updated_at) AS at FROM cryptocurrencies'),
      get: db.prepare(`SELECT ${COLUMNS} FROM cryptocurrencies WHERE id = ?`),
      conflict: db.prepare(`SELECT ${COLUMNS} FROM cryptocurrencies WHERE symbol = ? OR cmc_id = ? LIMIT 1`),
      count: db.prepare('SELECT count(*) AS n FROM cryptocurrencies'),
      insert: db.prepare(
        `INSERT INTO cryptocurrencies (cmc_id, symbol, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         RETURNING ${COLUMNS}`,
      ),
      // COALESCE: поле, которого нет в PATCH, остаётся прежним. Без динамической сборки SQL из ключей тела
      update: db.prepare(
        `UPDATE cryptocurrencies SET name = COALESCE(?, name), is_paused = COALESCE(?, is_paused), updated_at = ?
         WHERE id = ? RETURNING ${COLUMNS}`,
      ),
      delete: db.prepare('DELETE FROM cryptocurrencies WHERE id = ?'),
    };
  }

  async list(): Promise<CryptocurrencyRecord[]> {
    assertInTransaction(this.db);
    return (this.statements.list.all() as CryptocurrencyRow[]).map(toRecord);
  }

  async listActive(): Promise<CryptocurrencyRecord[]> {
    assertInTransaction(this.db);
    return (this.statements.listActive.all() as CryptocurrencyRow[]).map(toRecord);
  }

  async markUpdated(ids: readonly number[], at: number): Promise<void> {
    assertInTransaction(this.db);
    this.statements.markUpdated.run(sqlInt(at), JSON.stringify(ids));
  }

  async lastUpdatedAt(): Promise<number | null> {
    assertInTransaction(this.db);
    return (this.statements.lastUpdatedAt.get() as { at: number | null }).at;
  }

  async get(id: number): Promise<CryptocurrencyRecord | null> {
    assertInTransaction(this.db);
    const row = this.statements.get.get(sqlInt(id)) as CryptocurrencyRow | undefined;
    return row ? toRecord(row) : null;
  }

  async findConflict(symbol: string, cmcId: number | undefined): Promise<CryptocurrencyRecord | null> {
    assertInTransaction(this.db);
    // cmc_id > 0 по CHECK, поэтому 0 ни с чем не совпадёт
    const row = this.statements.conflict.get(symbol, sqlInt(cmcId ?? 0)) as CryptocurrencyRow | undefined;
    return row ? toRecord(row) : null;
  }

  async count(): Promise<number> {
    assertInTransaction(this.db);
    return (this.statements.count.get() as { n: number }).n;
  }

  async create(coin: NewCryptocurrency): Promise<CryptocurrencyRecord> {
    assertInTransaction(this.db);
    const at = sqlInt(coin.createdAt);
    return toRecord(
      this.statements.insert.get(sqlInt(coin.cmcId), coin.symbol, coin.name, at, at) as CryptocurrencyRow,
    );
  }

  async update(id: number, patch: CryptocurrencyPatch, at: number): Promise<CryptocurrencyRecord | null> {
    assertInTransaction(this.db);
    const isPaused = patch.isPaused === undefined ? null : sqlInt(patch.isPaused ? 1 : 0);
    const row = this.statements.update.get(patch.name ?? null, isPaused, sqlInt(at), sqlInt(id)) as
      CryptocurrencyRow | undefined;
    return row ? toRecord(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    assertInTransaction(this.db);
    return this.statements.delete.run(sqlInt(id)).changes > 0;
  }
}
