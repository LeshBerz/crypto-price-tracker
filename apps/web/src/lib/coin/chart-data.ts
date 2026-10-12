// Бакеты api → точки графика. Единственное место карточки, где цена становится `number`: график рисует
// на canvas, и точности пикселя достаточно (ADR 0006, 0012). Подписи вне canvas берутся из исходных строк.
import { INTERVAL_MS, type Interval } from './intervals';
import type { PriceBucket } from './queries';

export type ChartKind = 'candles' | 'line';

/** Время — секунды Unix: формат шкалы Lightweight Charts */
export type CandlePoint = { time: number; open: number; high: number; low: number; close: number };
export type LinePoint = { time: number; value: number };
/** Бакет без данных: место на шкале времени занято, но ничего не нарисовано */
export type GapPoint = { time: number };
export type ChartPoint = CandlePoint | LinePoint | GapPoint;

export function bucketTime(bucket: PriceBucket): number {
  return Date.parse(bucket.bucketStart) / 1000;
}

function toPoint(bucket: PriceBucket, kind: ChartKind): CandlePoint | LinePoint {
  const time = bucketTime(bucket);
  const { open, close, min, max } = bucket.stats;
  return kind === 'line'
    ? { time, value: Number(close) }
    : { time, open: Number(open), high: Number(max), low: Number(min), close: Number(close) };
}

/**
 * Точки графика с пропусками. Api не отдаёт пустые бакеты (ADR 0007), а шкала времени графика порядковая:
 * без пропусков соседние свечи встали бы вплотную и скрыли час, когда источник был недоступен. Между началом
 * и концом периода не больше 1000 бакетов, поэтому заполнение ограничено тем же пределом.
 */
export function toChartPoints(buckets: readonly PriceBucket[], interval: Interval, kind: ChartKind): ChartPoint[] {
  const step = INTERVAL_MS[interval] / 1000;
  const points: ChartPoint[] = [];
  let previous: number | null = null;
  for (const bucket of buckets) {
    const point = toPoint(bucket, kind);
    if (previous !== null) {
      for (let time = previous + step; time < point.time; time += step) points.push({ time });
    }
    points.push(point);
    previous = point.time;
  }
  return points;
}

function samePoint(a: ChartPoint | undefined, b: ChartPoint | undefined): boolean {
  if (!a || !b) return false;
  const left = a as Partial<CandlePoint & LinePoint>;
  const right = b as Partial<CandlePoint & LinePoint>;
  return (
    left.time === right.time &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.value === right.value
  );
}

export type SeriesPlan = { type: 'none' } | { type: 'update'; points: ChartPoint[] } | { type: 'reset' };

/**
 * Как привести нарисованный ряд к новым данным. Изменилась последняя точка или добавились новые справа —
 * достаточно `series.update()` для них: график не перечитывает ряд и не сбрасывает масштаб пользователя.
 * Любое другое отличие (другой период, правка в середине) — полная замена данных.
 */
export function planSeriesUpdate(shown: readonly ChartPoint[], next: readonly ChartPoint[]): SeriesPlan {
  if (shown.length === 0 || next.length < shown.length) {
    return shown.length === 0 && next.length === 0 ? { type: 'none' } : { type: 'reset' };
  }
  const lastShown = shown.length - 1;
  for (let index = 0; index < lastShown; index += 1) {
    if (!samePoint(shown[index], next[index])) return { type: 'reset' };
  }
  if (next[lastShown]?.time !== shown[lastShown]?.time) return { type: 'reset' };
  const points = next.slice(samePoint(shown[lastShown], next[lastShown]) ? lastShown + 1 : lastShown);
  return points.length === 0 ? { type: 'none' } : { type: 'update', points };
}

/**
 * Шаг шкалы цен по образцу цены: от 1 — цент, меньше 1 — шестая значащая цифра. Без него график округлял бы
 * мелкие цены до двух знаков и рисовал бы шкалу из одних нулей.
 */
export function priceStep(price: string): number {
  if (!price.startsWith('0.')) return 0.01;
  const zeros = /^0\.(0*)/.exec(price)?.[1]?.length ?? 0;
  return Number(`1e-${zeros + 6}`);
}
