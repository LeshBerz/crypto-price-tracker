// Порт хранилища цен (ADR 0015 §2). Пока — чтение последней цены; запись и история появятся в B11–B12.

export type LatestPriceRow = {
  cryptocurrencyId: number;
  price: string;
  sourceUpdatedAt: number;
  fetchedAt: number;
  /** Последняя цена, полученная не позже момента «сутки назад»; null — истории меньше суток */
  priceDayAgo: string | null;
};

export interface PriceRepository {
  /** Последняя цена каждой монеты из ids одним запросом (без N+1). Монеты без цен в ответ не попадают */
  latestFor(ids: readonly number[], dayAgo: number): Promise<LatestPriceRow[]>;
}
