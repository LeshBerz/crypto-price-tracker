// Транзакции поверх одного соединения node:sqlite. Основа адаптера порта UnitOfWork (ADR 0015).
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from './database.ts';

export class NestedTransactionError extends Error {
  override name = 'NestedTransactionError';
}

/**
 * Выполняет fn внутри BEGIN IMMEDIATE … COMMIT; при исключении — ROLLBACK и проброс ошибки.
 *
 * Соединение одно на процесс, поэтому транзакции сериализуются очередью: пока fn ждёт await,
 * второй вызов run не должен выполнить BEGIN на том же соединении («cannot start a transaction
 * within a transaction»). Параллельный вызов ждёт своей очереди, а вложенный (изнутри fn) — ошибка:
 * он ждал бы сам себя. Отличить одно от другого помогает AsyncLocalStorage — контекст текущей цепочки await.
 *
 * Внутри fn не должно быть сетевого ожидания (запроса в CMC и т. п.): транзакция держит блокировку
 * записи, а другие запросы того же процесса увидели бы её незакоммиченные данные. Поэтому синхронизация
 * сначала получает котировки и только потом открывает транзакцию (ADR 0015).
 */
export class TransactionRunner {
  private readonly db: Database;
  private readonly context = new AsyncLocalStorage<true>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(db: Database) {
    this.db = db;
  }

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.context.getStore()) {
      return Promise.reject(new NestedTransactionError('Вложенные транзакции не поддерживаются'));
    }
    const result = this.queue.then(() => this.context.run(true, () => this.execute(fn)));
    // Ошибка одной транзакции не должна ломать очередь для следующих
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async execute<T>(fn: () => Promise<T> | T): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = await fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
