// Адаптер SyncRunRepository на node:sqlite. «Не больше одного запуска» держит БД — частичный уникальный индекс.
import type { KeysetCursor } from '../../common/cursor.ts';
import type {
  SyncRunOutcome,
  SyncRunRecord,
  SyncRunRepository,
  SyncRunStatus,
  SyncTrigger,
} from '../../sync/sync-run-repository.ts';
import { sqlInt, type Database } from '../database.ts';
import { assertInTransaction } from '../transaction.ts';

type SyncRunRow = {
  id: number;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  started_at: number;
  finished_at: number | null;
  coins_requested: number;
  prices_saved: number;
  attempts: number;
  credits_used: number | null;
  error_code: string | null;
  error_message: string | null;
};

const COLUMNS =
  'id, trigger, status, started_at, finished_at, coins_requested, prices_saved, attempts, credits_used, error_code, error_message';

/** Расширенный код SQLite: нарушение UNIQUE (в Jest instanceof для ошибок node:* ложен — смотрим на код) */
const SQLITE_CONSTRAINT_UNIQUE = 2067;

function toRecord(row: SyncRunRow): SyncRunRecord {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    coinsRequested: row.coins_requested,
    pricesSaved: row.prices_saved,
    attempts: row.attempts,
    creditsUsed: row.credits_used,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

export class SqliteSyncRunRepository implements SyncRunRepository {
  private readonly db: Database;
  private readonly statements;

  constructor(db: Database) {
    this.db = db;
    this.statements = {
      start: db.prepare(
        `INSERT INTO sync_runs (trigger, status, started_at) VALUES (?, 'running', ?) RETURNING ${COLUMNS}`,
      ),
      finish: db.prepare(
        `UPDATE sync_runs
            SET status = ?, finished_at = ?, coins_requested = ?, prices_saved = ?, attempts = ?,
                credits_used = ?, error_code = ?, error_message = ?
          WHERE id = ? RETURNING ${COLUMNS}`,
      ),
      get: db.prepare(`SELECT ${COLUMNS} FROM sync_runs WHERE id = ?`),
      running: db.prepare(`SELECT ${COLUMNS} FROM sync_runs WHERE status = 'running'`),
      latest: db.prepare(`SELECT ${COLUMNS} FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT 1`),
      latestWithStatus: db.prepare(
        `SELECT ${COLUMNS} FROM sync_runs WHERE status IN (SELECT value FROM json_each(?))
          ORDER BY started_at DESC, id DESC LIMIT 1`,
      ),
      // Сравнение кортежей (started_at, id) < (?, ?) — keyset: страница не «плывёт», когда появляются новые запуски
      page: db.prepare(
        `SELECT ${COLUMNS} FROM sync_runs WHERE (started_at, id) < (?, ?)
          ORDER BY started_at DESC, id DESC LIMIT ?`,
      ),
      // max(): finished_at >= started_at по CHECK, даже если часы за время простоя перевели назад
      markInterrupted: db.prepare(
        `UPDATE sync_runs SET status = 'interrupted', finished_at = max(started_at, ?) WHERE status = 'running'`,
      ),
    };
  }

  async start(trigger: SyncTrigger, startedAt: number): Promise<SyncRunRecord | null> {
    assertInTransaction(this.db);
    try {
      return toRecord(this.statements.start.get(trigger, sqlInt(startedAt)) as SyncRunRow);
    } catch (error) {
      if ((error as { errcode?: number }).errcode === SQLITE_CONSTRAINT_UNIQUE) return null;
      throw error;
    }
  }

  async finish(id: number, outcome: SyncRunOutcome): Promise<SyncRunRecord> {
    assertInTransaction(this.db);
    const row = this.statements.finish.get(
      outcome.status,
      sqlInt(outcome.finishedAt),
      sqlInt(outcome.coinsRequested),
      sqlInt(outcome.pricesSaved),
      sqlInt(outcome.attempts),
      outcome.creditsUsed === null ? null : sqlInt(outcome.creditsUsed),
      outcome.errorCode ?? null,
      outcome.errorMessage ?? null,
      sqlInt(id),
    ) as SyncRunRow | undefined;
    if (!row) throw new Error(`Запуск синхронизации ${id} не найден`);
    return toRecord(row);
  }

  async get(id: number): Promise<SyncRunRecord | null> {
    assertInTransaction(this.db);
    const row = this.statements.get.get(sqlInt(id)) as SyncRunRow | undefined;
    return row ? toRecord(row) : null;
  }

  async running(): Promise<SyncRunRecord | null> {
    assertInTransaction(this.db);
    const row = this.statements.running.get() as SyncRunRow | undefined;
    return row ? toRecord(row) : null;
  }

  async latest(): Promise<SyncRunRecord | null> {
    assertInTransaction(this.db);
    const row = this.statements.latest.get() as SyncRunRow | undefined;
    return row ? toRecord(row) : null;
  }

  async latestWithStatus(statuses: readonly SyncRunStatus[]): Promise<SyncRunRecord | null> {
    assertInTransaction(this.db);
    const row = this.statements.latestWithStatus.get(JSON.stringify(statuses)) as SyncRunRow | undefined;
    return row ? toRecord(row) : null;
  }

  async page(limit: number, before: KeysetCursor | null): Promise<SyncRunRecord[]> {
    assertInTransaction(this.db);
    const at = before?.at ?? Number.MAX_SAFE_INTEGER;
    const id = before?.id ?? Number.MAX_SAFE_INTEGER;
    return (this.statements.page.all(sqlInt(at), sqlInt(id), sqlInt(limit)) as SyncRunRow[]).map(toRecord);
  }

  async markInterrupted(at: number): Promise<number> {
    assertInTransaction(this.db);
    return Number(this.statements.markInterrupted.run(sqlInt(at)).changes);
  }
}
