// Адаптер PriceRepository на node:sqlite. Цена — точная TEXT-строка (ADR 0006), порядок — по fetched_at.
import type { LatestPriceRow, PriceRepository } from '../../prices/price-repository.ts';
import { sqlInt, type Database } from '../database.ts';
import { assertInTransaction } from '../transaction.ts';

type Row = {
  cryptocurrency_id: number;
  price: string;
  source_updated_at: number;
  fetched_at: number;
  price_day_ago: string | null;
};

export class SqlitePriceRepository implements PriceRepository {
  private readonly db: Database;
  private readonly statements;

  constructor(db: Database) {
    this.db = db;
    this.statements = {
      // Список id — одним параметром через json_each: один подготовленный запрос на любое число монет.
      // Оба подзапроса идут по индексу (cryptocurrency_id, fetched_at) с LIMIT 1, без сканирования истории
      latestFor: db.prepare(`
        SELECT h.cryptocurrency_id, h.price, h.source_updated_at, h.fetched_at,
               (SELECT d.price FROM price_history d
                 WHERE d.cryptocurrency_id = h.cryptocurrency_id AND d.fetched_at <= ?
                 ORDER BY d.fetched_at DESC, d.id DESC LIMIT 1) AS price_day_ago
          FROM json_each(?) AS ids
          JOIN price_history h ON h.id = (
                SELECT l.id FROM price_history l
                 WHERE l.cryptocurrency_id = ids.value
                 ORDER BY l.fetched_at DESC, l.id DESC LIMIT 1)
         ORDER BY h.cryptocurrency_id`),
    };
  }

  async latestFor(ids: readonly number[], dayAgo: number): Promise<LatestPriceRow[]> {
    assertInTransaction(this.db);
    if (ids.length === 0) return [];
    const rows = this.statements.latestFor.all(sqlInt(dayAgo), JSON.stringify(ids)) as Row[];
    return rows.map((row) => ({
      cryptocurrencyId: row.cryptocurrency_id,
      price: row.price,
      sourceUpdatedAt: row.source_updated_at,
      fetchedAt: row.fetched_at,
      priceDayAgo: row.price_day_ago,
    }));
  }
}
