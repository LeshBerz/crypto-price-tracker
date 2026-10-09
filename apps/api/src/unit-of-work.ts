// Порт UnitOfWork (ADR 0015 §2): всё, что ядро делает с БД, идёт через run(fn) — одна транзакция,
// внутри доступны репозитории. Аналог в Nest — DataSource.transaction(manager => …) в TypeORM, только без ORM.
import type { ApiKeyRepository } from './auth/api-key-repository.ts';

export type Repositories = {
  apiKeys: ApiKeyRepository;
};

export interface UnitOfWork {
  /**
   * Выполняет work в транзакции: исключение — откат. Внутри — только работа с БД, без сети и Clock.sleep
   * (транзакция держит соединение, ADR 0015). События публикуются после того, как run вернул результат.
   */
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
