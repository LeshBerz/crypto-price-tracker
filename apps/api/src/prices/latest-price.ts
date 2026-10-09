// Последняя цена в формате контракта (LatestPrice, ADR 0014): свежесть и изменение за сутки считаются здесь,
// точно — в Decimal (ADR 0006), а не во float.
import { Decimal } from '../common/decimal.ts';
import type { components } from '../generated/api-types.ts';
import type { LatestPriceRow } from './price-repository.ts';

export type LatestPrice = components['schemas']['LatestPrice'];

export const DAY_MS = 86_400_000;
/** Знаков после запятой у процентов (ADR 0007: changePercent, HALF_EVEN) */
export const PERCENT_SCALE = 4;

/** (new − old) / old × 100, 4 знака, банковское округление */
export function changePercent(from: string, to: string): string {
  const base = Decimal.parse(from);
  return Decimal.parse(to).sub(base).mul(Decimal.of(100n)).div(base, PERCENT_SCALE).toString();
}

export function toLatestPrice(row: LatestPriceRow, now: number, syncIntervalMs: number): LatestPrice {
  return {
    price: row.price,
    currency: 'USD',
    sourceUpdatedAt: new Date(row.sourceUpdatedAt).toISOString(),
    fetchedAt: new Date(row.fetchedAt).toISOString(),
    change24hPercent: row.priceDayAgo === null ? null : changePercent(row.priceDayAgo, row.price),
    // Пропущена одна синхронизация — ещё не повод тревожить; две подряд — CMC лежит или планировщик стоит (F7)
    isStale: now - row.fetchedAt > 2 * syncIntervalMs,
  };
}
