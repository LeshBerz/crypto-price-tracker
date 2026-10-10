// Порт хранилища цен (ADR 0015 §2): последняя цена, сырая история и агрегаты из часовых свёрток (ADR 0007).
import type { KeysetCursor } from '../common/cursor.ts';

export type LatestPriceRow = {
  cryptocurrencyId: number;
  price: string;
  sourceUpdatedAt: number;
  fetchedAt: number;
  /** Последняя цена, полученная не позже момента «сутки назад»; null — истории меньше суток */
  priceDayAgo: string | null;
};

export type PricePointRow = { id: number; price: string; sourceUpdatedAt: number; fetchedAt: number };

/** Период [from, to); before — курсор последней строки предыдущей страницы */
export type HistoryQuery = { from: number; to: number; limit: number; before: KeysetCursor | null };

/**
 * Сетка бакетов: начало бакета = floor((t + offsetMs) / sizeMs) · sizeMs − offsetMs.
 * offsetMs нужен неделям: эпоха Unix началась в четверг, а неделя — с понедельника.
 */
export type BucketGrid = { sizeMs: number; offsetMs: number };
export type BucketQuery = BucketGrid & { from: number; to: number };

export type PriceBucketRow = {
  bucketStart: number;
  points: number;
  open: string;
  close: string;
  min: string;
  max: string;
  /** Сумма цен в double — только для avg (статистика, ADR 0007) */
  sumNum: number;
};

export type CloseRow = { cryptocurrencyId: number; bucketStart: number; close: string };

export interface PriceRepository {
  /** Последняя цена каждой монеты из ids одним запросом (без N+1). Монеты без цен в ответ не попадают */
  latestFor(ids: readonly number[], dayAgo: number): Promise<LatestPriceRow[]>;
  /** Сырые точки от новых к старым */
  history(cryptocurrencyId: number, query: HistoryQuery): Promise<PricePointRow[]>;
  /** Бакеты по возрастанию времени; пустых бакетов в ответе нет */
  buckets(cryptocurrencyId: number, query: BucketQuery): Promise<PriceBucketRow[]>;
  /** Цены закрытия бакетов сразу для всех монет из ids (мини-графики без N+1) */
  closes(ids: readonly number[], query: BucketQuery): Promise<CloseRow[]>;
}
