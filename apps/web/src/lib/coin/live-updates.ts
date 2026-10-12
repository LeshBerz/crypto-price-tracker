// Событие `price.updated` → данные карточки в кэше запросов. Чистые функции: сеть и React не участвуют.
import type { components } from '@/generated/api-types';
import { compareDecimal } from '@/lib/format';
import { bucketStartOf } from './intervals';
import type { Cryptocurrency, PriceAggregates, PriceBucket, PriceHistory } from './queries';

type LatestPrice = components['schemas']['LatestPrice'];

export type PriceUpdate = {
  cryptocurrencyId: number;
  price: string;
  currency: string;
  sourceUpdatedAt: string;
  fetchedAt: string;
};

/**
 * Последняя цена после события, или `null`, если событие старше уже показанной цены (переподключение).
 * Только что сохранённая цена устаревшей быть не может, поэтому `isStale` сбрасывается сразу; изменение
 * за 24 ч остаётся прежним до ближайшего `sync.finished` — его считает сервер.
 */
export function nextLatest(previous: LatestPrice | null, update: PriceUpdate): LatestPrice | null {
  if (previous && Date.parse(update.fetchedAt) < Date.parse(previous.fetchedAt)) return null;
  return {
    price: update.price,
    currency: update.currency as LatestPrice['currency'],
    sourceUpdatedAt: update.sourceUpdatedAt,
    fetchedAt: update.fetchedAt,
    change24hPercent: previous?.change24hPercent ?? null,
    isStale: false,
  };
}

export function applyPriceToCoin(coin: Cryptocurrency, update: PriceUpdate): Cryptocurrency {
  const latestPrice = nextLatest(coin.latestPrice, update);
  return latestPrice ? { ...coin, latestPrice, lastUpdatedAt: update.fetchedAt } : coin;
}

/**
 * Новая цена в последней свече. Открытие, закрытие, минимум и максимум — наблюдённые цены: они обновляются
 * точно, сравнением строк. Среднее, изменение, число точек и сводку за период считает сервер — они
 * перечитываются по `sync.finished`, а до тех пор остаются прежними: пересчёт на клиенте потребовал бы
 * десятичной арифметики и разошёлся бы с правилами округления api.
 */
export function applyPriceToAggregates(aggregates: PriceAggregates, update: PriceUpdate): PriceAggregates {
  const start = bucketStartOf(Date.parse(update.fetchedAt), aggregates.interval);
  const last = aggregates.buckets[aggregates.buckets.length - 1];
  const lastStart = last ? Date.parse(last.bucketStart) : null;
  // Цена из бакета левее последнего: событие пришло не по порядку, график назад не переписывается
  if (lastStart !== null && start < lastStart) return aggregates;

  const { price } = update;
  if (last && lastStart === start) {
    const { stats } = last;
    if (stats.close === price) return aggregates;
    const updated: PriceBucket = {
      ...last,
      stats: {
        ...stats,
        close: price,
        min: compareDecimal(price, stats.min) < 0 ? price : stats.min,
        max: compareDecimal(price, stats.max) > 0 ? price : stats.max,
      },
    };
    return { ...aggregates, buckets: [...aggregates.buckets.slice(0, -1), updated] };
  }

  const opened: PriceBucket = {
    bucketStart: new Date(start).toISOString(),
    stats: { open: price, close: price, min: price, max: price, avg: price, changePercent: '0', points: 1 },
  };
  return { ...aggregates, buckets: [...aggregates.buckets, opened] };
}

/** Новая точка — первой строкой истории. Курсор следующей страницы от этого не меняется: он указывает на старые */
export function prependHistoryPoint(history: PriceHistory, update: PriceUpdate): PriceHistory {
  const [first, ...rest] = history.pages;
  if (!first) return history;
  const newest = first.items[0];
  if (newest && Date.parse(update.fetchedAt) <= Date.parse(newest.fetchedAt)) return history;
  if (first.items.some((point) => point.sourceUpdatedAt === update.sourceUpdatedAt)) return history;
  const point = { price: update.price, sourceUpdatedAt: update.sourceUpdatedAt, fetchedAt: update.fetchedAt };
  return { ...history, pages: [{ ...first, items: [point, ...first.items] }, ...rest] };
}
