// Адаптер PriceRepository на node:sqlite. Цена — точная TEXT-строка (ADR 0006), порядок — по fetched_at.
import type {
  BucketQuery,
  CloseRow,
  HistoryQuery,
  NewPricePoint,
  LatestPriceRow,
  PriceBucketRow,
  PricePointRow,
  PriceRepository,
} from '../../prices/price-repository.ts';
import { sqlInt, type Database } from '../database.ts';
import { assertInTransaction } from '../transaction.ts';

type Row = {
  cryptocurrency_id: number;
  price: string;
  source_updated_at: number;
  fetched_at: number;
  price_day_ago: string | null;
};
type PointRow = { id: number; price: string; source_updated_at: number; fetched_at: number };
type BucketRow = {
  bucket_start: number;
  points: number;
  open: string;
  close: string;
  min: string;
  max: string;
  sum_num: number;
};
type CloseDbRow = { cryptocurrency_id: number; bucket_start: number; close: string };

const HOUR_MS = 3_600_000;
/** Номер бакета на сетке (offset, size); параметры — offset, size, size, offset. Деление целочисленное (sqlInt) */
const BUCKET = '((bucket_start + ?) / ?) * ? - ?';

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
      // ON CONFLICT DO NOTHING: повторная синхронизация той же котировки идемпотентна (UNIQUE по монете и
      // source_updated_at). WHERE EXISTS: монету могли удалить, пока шёл запрос к CMC, — без него упал бы FK
      insert: db.prepare(`
        INSERT INTO price_history (cryptocurrency_id, sync_run_id, price, source_updated_at, fetched_at)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM cryptocurrencies WHERE id = ?)
        ON CONFLICT (cryptocurrency_id, source_updated_at) DO NOTHING`),
      // Свёртка часа пересчитывается целиком из сырых точек (их в часе единицы), а не «доливается»:
      // результат не зависит от того, сколько раз и в каком порядке её считали. open/close — по времени,
      // min/max — по REAL, но в свёртку попадает точная TEXT-строка той же точки
      rollup: db.prepare(`
        WITH h AS (
          SELECT id, price, price_num, fetched_at FROM price_history
           WHERE cryptocurrency_id = ? AND fetched_at >= ? AND fetched_at < ?)
        INSERT INTO price_rollups_1h (cryptocurrency_id, bucket_start, points, open, close, min, max, sum_num)
        SELECT ?, ?, count(*),
               (SELECT price FROM h ORDER BY fetched_at, id LIMIT 1),
               (SELECT price FROM h ORDER BY fetched_at DESC, id DESC LIMIT 1),
               (SELECT price FROM h ORDER BY price_num, id LIMIT 1),
               (SELECT price FROM h ORDER BY price_num DESC, id LIMIT 1),
               sum(price_num)
          FROM h WHERE true HAVING count(*) > 0
        ON CONFLICT (cryptocurrency_id, bucket_start) DO UPDATE SET
          points = excluded.points, open = excluded.open, close = excluded.close,
          min = excluded.min, max = excluded.max, sum_num = excluded.sum_num`),
      // Keyset по (fetched_at, id): следующая страница начинается строго после курсора, поэтому вставки между
      // запросами не дают ни дублей, ни пропусков (у OFFSET — дают). Идёт по индексу price_history_coin_time
      history: db.prepare(`
        SELECT id, price, source_updated_at, fetched_at
          FROM price_history
         WHERE cryptocurrency_id = ? AND fetched_at >= ? AND fetched_at < ? AND (fetched_at, id) < (?, ?)
         ORDER BY fetched_at DESC, id DESC LIMIT ?`),
      hourly: db.prepare(`
        SELECT bucket_start, points, open, close, min, max, sum_num
          FROM price_rollups_1h
         WHERE cryptocurrency_id = ? AND bucket_start >= ? AND bucket_start < ?
         ORDER BY bucket_start`),
      // 4h/1d/1w собираются из часовых свёрток на лету. Bare columns SQLite: рядом с единственным min()/max()
      // «голая» колонка берётся из той строки, где достигнут экстремум. Так open/close/min/max остаются точными
      // TEXT-строками наблюдённых цен, а сравнение идёт по REAL (MIN по TEXT был бы лексикографическим)
      grouped: db.prepare(`
        WITH r AS (
          SELECT ${BUCKET} AS b, bucket_start, points, open, close, min, max, min_num, max_num, sum_num
            FROM price_rollups_1h
           WHERE cryptocurrency_id = ? AND bucket_start >= ? AND bucket_start < ?)
        SELECT t.b AS bucket_start, t.points, o.open, c.close, lo.min, hi.max, t.sum_num
          FROM (SELECT b, sum(points) AS points, sum(sum_num) AS sum_num FROM r GROUP BY b) AS t
          JOIN (SELECT b, open, min(bucket_start) FROM r GROUP BY b) AS o USING (b)
          JOIN (SELECT b, close, max(bucket_start) FROM r GROUP BY b) AS c USING (b)
          JOIN (SELECT b, min, min(min_num) FROM r GROUP BY b) AS lo USING (b)
          JOIN (SELECT b, max, max(max_num) FROM r GROUP BY b) AS hi USING (b)
         ORDER BY t.b`),
      // Один запрос на весь watchlist: close бакета — close последнего часа в нём (bare column при max)
      closes: db.prepare(`
        SELECT cryptocurrency_id, ${BUCKET} AS bucket_start, close, max(bucket_start)
          FROM json_each(?) AS ids
          JOIN price_rollups_1h ON cryptocurrency_id = ids.value AND bucket_start >= ? AND bucket_start < ?
         GROUP BY cryptocurrency_id, 2
         ORDER BY cryptocurrency_id, 2`),
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

  async insertMany(points: readonly NewPricePoint[]): Promise<NewPricePoint[]> {
    assertInTransaction(this.db);
    return points.filter((point) => {
      const coin = sqlInt(point.cryptocurrencyId);
      const result = this.statements.insert.run(
        coin,
        sqlInt(point.syncRunId),
        point.price,
        sqlInt(point.sourceUpdatedAt),
        sqlInt(point.fetchedAt),
        coin,
      );
      return result.changes > 0;
    });
  }

  async recomputeRollup(cryptocurrencyId: number, hourStart: number): Promise<void> {
    assertInTransaction(this.db);
    const [coin, from, to] = [sqlInt(cryptocurrencyId), sqlInt(hourStart), sqlInt(hourStart + HOUR_MS)];
    this.statements.rollup.run(coin, from, to, coin, from);
  }

  async history(cryptocurrencyId: number, query: HistoryQuery): Promise<PricePointRow[]> {
    assertInTransaction(this.db);
    const rows = this.statements.history.all(
      sqlInt(cryptocurrencyId),
      sqlInt(query.from),
      sqlInt(query.to),
      sqlInt(query.before?.at ?? Number.MAX_SAFE_INTEGER),
      sqlInt(query.before?.id ?? Number.MAX_SAFE_INTEGER),
      sqlInt(query.limit),
    ) as PointRow[];
    return rows.map((row) => ({
      id: row.id,
      price: row.price,
      sourceUpdatedAt: row.source_updated_at,
      fetchedAt: row.fetched_at,
    }));
  }

  async buckets(cryptocurrencyId: number, query: BucketQuery): Promise<PriceBucketRow[]> {
    assertInTransaction(this.db);
    const [coin, from, to] = [sqlInt(cryptocurrencyId), sqlInt(query.from), sqlInt(query.to)];
    const [size, offset] = [sqlInt(query.sizeMs), sqlInt(query.offsetMs)];
    const rows = (
      query.sizeMs === HOUR_MS
        ? this.statements.hourly.all(coin, from, to)
        : this.statements.grouped.all(offset, size, size, offset, coin, from, to)
    ) as BucketRow[];
    return rows.map((row) => ({
      bucketStart: row.bucket_start,
      points: row.points,
      open: row.open,
      close: row.close,
      min: row.min,
      max: row.max,
      sumNum: row.sum_num,
    }));
  }

  async closes(ids: readonly number[], query: BucketQuery): Promise<CloseRow[]> {
    assertInTransaction(this.db);
    if (ids.length === 0) return [];
    const [size, offset] = [sqlInt(query.sizeMs), sqlInt(query.offsetMs)];
    const rows = this.statements.closes.all(
      offset,
      size,
      size,
      offset,
      JSON.stringify(ids),
      sqlInt(query.from),
      sqlInt(query.to),
    ) as CloseDbRow[];
    return rows.map((row) => ({
      cryptocurrencyId: row.cryptocurrency_id,
      bucketStart: row.bucket_start,
      close: row.close,
    }));
  }
}
