// Адаптер порта UnitOfWork на node:sqlite: очередь транзакций TransactionRunner + репозитории на одном соединении.
import type { Repositories, UnitOfWork } from '../unit-of-work.ts';
import type { Database } from './database.ts';
import { SqliteApiKeyRepository } from './repositories/api-keys.ts';
import { TransactionRunner } from './transaction.ts';

export class SqliteUnitOfWork implements UnitOfWork {
  private readonly tx: TransactionRunner;
  // Репозитории создаются один раз: запросы в них подготовлены заранее, а не на каждый вызов
  private readonly repos: Repositories;

  constructor(db: Database) {
    this.tx = new TransactionRunner(db);
    this.repos = { apiKeys: new SqliteApiKeyRepository(db) };
  }

  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.tx.run(() => work(this.repos));
  }
}
