// Порт EventBus и in-process адаптер (ADR 0015 §3). Публикуем только после COMMIT: иначе при откате
// SSE-клиент увидел бы изменение, которого нет в БД (phantom event). Семантика — at-most-once: данные в БД,
// а клиенты после переподключения перечитывают состояние через REST.
import { randomUUID } from 'node:crypto';
import type { Clock } from '../common/clock.ts';
import type { Logger } from '../common/logger.ts';
import type { components } from '../generated/api-types.ts';

export type DomainEvent<T extends string, P> = {
  id: string;
  type: T;
  /** Версия схемы payload — для эволюции без поломки потребителей */
  version: 1;
  occurredAt: string;
  payload: P;
};

export type WatchlistChanged = DomainEvent<
  'watchlist.changed',
  { cryptocurrencyId: number; change: 'added' | 'updated' | 'removed' }
>;

/** По одному на каждую сохранённую цену; время — ISO 8601, как в контракте */
export type PriceUpdated = DomainEvent<
  'price.updated',
  {
    cryptocurrencyId: number;
    symbol: string;
    price: string;
    currency: 'USD';
    sourceUpdatedAt: string;
    fetchedAt: string;
    syncRunId: number;
  }
>;

/** Запуск синхронизации завершён; payload — SyncRun как в контракте */
export type SyncFinished = DomainEvent<'sync.finished', components['schemas']['SyncRun']>;

/** Каталог событий (ADR 0015 §3) */
export type AppEvent = WatchlistChanged | PriceUpdated | SyncFinished;
export type AppEventType = AppEvent['type'];
type EventOf<T extends AppEventType> = Extract<AppEvent, { type: T }>;

export interface EventBus {
  publish(event: AppEvent): void;
  /** Возвращает функцию отписки */
  subscribe<T extends AppEventType>(type: T, handler: (event: EventOf<T>) => void): () => void;
}

export function createEvent<T extends AppEventType>(type: T, payload: EventOf<T>['payload'], clock: Clock): EventOf<T> {
  return { id: randomUUID(), type, version: 1, occurredAt: new Date(clock.now()).toISOString(), payload } as EventOf<T>;
}

export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<AppEventType, Set<(event: AppEvent) => void>>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  publish(event: AppEvent): void {
    for (const handler of [...(this.handlers.get(event.type) ?? [])]) {
      // Ошибка одного потребителя не ломает ни издателя, ни соседей
      try {
        handler(event);
      } catch (error) {
        this.logger.error('event handler failed', { eventType: event.type, eventId: event.id, error });
      }
    }
  }

  subscribe<T extends AppEventType>(type: T, handler: (event: EventOf<T>) => void): () => void {
    const set = this.handlers.get(type) ?? new Set();
    const wrapped = handler as (event: AppEvent) => void;
    set.add(wrapped);
    this.handlers.set(type, set);
    return () => {
      set.delete(wrapped);
    };
  }
}
