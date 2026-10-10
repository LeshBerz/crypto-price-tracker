// Агрегаты цен в формате контракта (AggregateStats, ADR 0007): сетки интервалов и статистика бакета.
// open/close/min/max — точные наблюдённые цены (строки из БД), avg — статистика в double, проценты — в Decimal.
import { Decimal } from '../common/decimal.ts';
import type { components } from '../generated/api-types.ts';
import { changePercent, DAY_MS } from './latest-price.ts';
import type { BucketGrid, PriceBucketRow } from './price-repository.ts';

export type AggregateStats = components['schemas']['AggregateStats'];
export type AggregateInterval = components['schemas']['PriceAggregates']['interval'];
export type SparklineWindow = components['schemas']['SparklineList']['window'];

export const HOUR_MS = 3_600_000;
/** Больше бакетов за запрос не отдаём: валидация входа (C10) и защита Event Loop разом */
export const MAX_BUCKETS = 1000;
/** Значащих цифр у avg (ADR 0007) */
export const AVG_SIGNIFICANT_DIGITS = 10;

export const INTERVALS: Record<AggregateInterval, BucketGrid> = {
  '1h': { sizeMs: HOUR_MS, offsetMs: 0 },
  '4h': { sizeMs: 4 * HOUR_MS, offsetMs: 0 },
  '1d': { sizeMs: DAY_MS, offsetMs: 0 },
  // 01.01.1970 — четверг: сдвиг на 3 дня переносит границу недели на понедельник
  '1w': { sizeMs: 7 * DAY_MS, offsetMs: 3 * DAY_MS },
};

export const SPARKLINES: Record<SparklineWindow, { interval: '1h' | '4h'; points: number }> = {
  '24h': { interval: '1h', points: 24 },
  '7d': { interval: '4h', points: 42 },
};

export function bucketStartOf(at: number, grid: BucketGrid): number {
  return Math.floor((at + grid.offsetMs) / grid.sizeMs) * grid.sizeMs - grid.offsetMs;
}

export function toStats(bucket: PriceBucketRow): AggregateStats {
  return {
    open: bucket.open,
    close: bucket.close,
    min: bucket.min,
    max: bucket.max,
    // Среднее — статистика, а не сумма к оплате: double хватает, наружу — 10 значащих цифр строкой
    avg: Decimal.parse(String(bucket.sumNum / bucket.points))
      .roundSignificant(AVG_SIGNIFICANT_DIGITS)
      .toString(),
    changePercent: changePercent(bucket.open, bucket.close),
    points: bucket.points,
  };
}

/** Сводка за весь период из уже полученных бакетов (их ≤ 1000); null — данных нет */
export function summarize(buckets: readonly PriceBucketRow[]): AggregateStats | null {
  const [first] = buckets;
  if (first === undefined) return null;
  const total = { ...first };
  for (const bucket of buckets.slice(1)) {
    total.close = bucket.close;
    // Экстремумы сравниваем точно, в Decimal: у соседних цен double может совпасть
    if (Decimal.parse(bucket.min).compare(Decimal.parse(total.min)) < 0) total.min = bucket.min;
    if (Decimal.parse(bucket.max).compare(Decimal.parse(total.max)) > 0) total.max = bucket.max;
    total.points += bucket.points;
    total.sumNum += bucket.sumNum;
  }
  return toStats(total);
}
