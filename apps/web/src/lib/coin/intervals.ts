// Интервал бакета и период графика карточки монеты: допустимые сочетания и границы запроса агрегатов (ADR 0007).
import type { operations } from '@/generated/api-types';

export type Interval = operations['getPriceAggregates']['parameters']['query']['interval'];
export type Period = '24h' | '7d' | '30d' | '1y';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const INTERVAL_MS: Record<Interval, number> = { '1h': HOUR, '4h': 4 * HOUR, '1d': DAY, '1w': 7 * DAY };
export const PERIOD_MS: Record<Period, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '1y': 365 * DAY };

export const INTERVALS = Object.keys(INTERVAL_MS) as Interval[];
export const PERIODS = Object.keys(PERIOD_MS) as Period[];

export const INTERVAL_LABEL: Record<Interval, string> = { '1h': '1 ч', '4h': '4 ч', '1d': '1 д', '1w': '1 нед' };
export const PERIOD_LABEL: Record<Period, string> = { '24h': '24 ч', '7d': '7 д', '30d': '30 д', '1y': '1 год' };

export const DEFAULT_INTERVAL: Interval = '1h';
export const DEFAULT_PERIOD: Period = '7d';

/** Предел api: `(to − from) / interval ≤ 1000`, иначе 400 */
export const MAX_BUCKETS = 1000;
/** Меньше двух бакетов — не график, а одна свеча */
export const MIN_BUCKETS = 2;

export function bucketCount(interval: Interval, period: Period): number {
  return PERIOD_MS[period] / INTERVAL_MS[interval];
}

/**
 * Почему сочетание недоступно, или `null`. Проверка повторяет правило api до запроса: кнопка неактивна
 * и объясняет причину, вместо ответа 400 после нажатия.
 */
export function comboIssue(interval: Interval, period: Period): string | null {
  const count = bucketCount(interval, period);
  const combo = `${INTERVAL_LABEL[interval]} × ${PERIOD_LABEL[period]}`;
  if (count > MAX_BUCKETS) {
    return `${combo} — это ${Math.round(count).toLocaleString('ru-RU')} бакетов, больше предела ${MAX_BUCKETS}. Выберите интервал крупнее или период короче.`;
  }
  if (count < MIN_BUCKETS) {
    return `${combo} — меньше двух бакетов, график не построить. Выберите интервал мельче или период длиннее.`;
  }
  return null;
}

/** Эпоха Unix — четверг: сдвиг на три дня выравнивает недельные бакеты по понедельнику, как в api */
const WEEK_OFFSET = 3 * DAY;

/** Начало бакета, в который попадает момент `time` (мс). Бакеты выровнены по UTC, недели — с понедельника */
export function bucketStartOf(time: number, interval: Interval): number {
  const size = INTERVAL_MS[interval];
  const offset = interval === '1w' ? WEEK_OFFSET : 0;
  return Math.floor((time + offset) / size) * size - offset;
}

/**
 * Начало периода для запроса агрегатов. Выравнивается по границе бакета: иначе первый бакет собирался бы
 * из части часов и выглядел бы на графике как полноценная свеча.
 */
export function periodFrom(now: number, interval: Interval, period: Period): string {
  return new Date(bucketStartOf(now - PERIOD_MS[period], interval)).toISOString();
}
