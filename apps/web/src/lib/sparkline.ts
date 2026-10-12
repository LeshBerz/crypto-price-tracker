// Геометрия мини-графика: свой SVG вместо второй библиотеки графиков (ADR 0012).
import type { components } from '@/generated/api-types';
import type { Direction } from './format';

type SparklinePoint = components['schemas']['SparklinePoint'];

export type SparklineGeometry = { path: string; trend: Direction };

/** Изменение меньше 0,1 % за окно — «шум» (стейблкоин): линия остаётся нейтральной */
const FLAT_THRESHOLD = 0.001;

/**
 * Путь SVG по ценам закрытия. Перевод в number допустим: это координаты пикселей, а не денежная арифметика —
 * потеря точности в 16-м знаке на полоске высотой 30 px не видна. Меньше двух точек — рисовать нечего.
 */
export function sparklineGeometry(
  points: readonly SparklinePoint[],
  width: number,
  height: number,
): SparklineGeometry | null {
  if (points.length < 2) return null;
  const values = points.map((point) => Number(point.close));
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;

  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (width - 2) + 1;
      const y = height - 3 - ((value - min) / span) * (height - 6);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('');

  const relative = first === 0 ? 0 : Math.abs(last - first) / first;
  const trend: Direction = relative < FLAT_THRESHOLD ? 'flat' : last > first ? 'up' : 'down';
  return { path, trend };
}
