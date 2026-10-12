// «Линза точности»: разбор строки цены из api по цифрам. Строка в `number` не переводится (ADR 0006):
// все счётчики и границы считаются по символам, поэтому цена любой длины раскладывается без потерь.

/** Столько знаков после запятой показывает интерфейс у цены от 1 (см. `formatPrice`) */
const SHOWN_FRACTION_DIGITS = 2;
/** Столько значащих цифр показывает интерфейс у цены меньше 1 */
const SHOWN_SIGNIFICANT_DIGITS = 6;
const GROUP = 3;

export type LensDigit = {
  char: string;
  /** Цифра есть в строке api, но в интерфейсе срезана округлением */
  hidden: boolean;
  /** Ноль перед первой значащей цифрой: `0.000012` — четыре таких нуля */
  leadingZero: boolean;
  /** Перед цифрой начинается новая группа из трёх */
  groupStart: boolean;
  /** Порядковый номер среди скрытых цифр — для задержки анимации; у видимых −1 */
  hiddenIndex: number;
};

export type LensView = {
  /** Целая часть с пробелами между группами: `67 123` */
  integer: string;
  fraction: LensDigit[];
  /** Значащих цифр в строке api */
  significant: number;
  /** Из них видно в интерфейсе */
  shown: number;
};

function groupInteger(integer: string): string {
  const head = integer.length % GROUP;
  const groups = head > 0 ? [integer.slice(0, head)] : [];
  for (let index = head; index < integer.length; index += GROUP) groups.push(integer.slice(index, index + GROUP));
  return groups.join(' ');
}

/**
 * Раскладывает Decimal контракта (неотрицательный, без ведущих нулей, кроме самого `0`) на цифры с пометками.
 * Правило «что видно» повторяет `formatPrice`: от 1 — два знака после запятой, меньше 1 — шесть значащих цифр.
 */
export function lensView(price: string): LensView {
  const [integer = '0', fractionText = ''] = price.split('.');
  const belowOne = integer === '0';
  // У цены от 1 значащие цифры начинаются в целой части, у цены меньше 1 — после ведущих нулей дроби
  let significant = belowOne ? 0 : integer.length;
  let hiddenCount = 0;

  const fraction = Array.from(fractionText, (char, index): LensDigit => {
    const leadingZero = significant === 0 && char === '0';
    if (!leadingZero) significant += 1;
    const hidden = belowOne ? significant > SHOWN_SIGNIFICANT_DIGITS : index >= SHOWN_FRACTION_DIGITS;
    const hiddenIndex = hidden ? hiddenCount++ : -1;
    return { char, hidden, leadingZero, groupStart: index > 0 && index % GROUP === 0, hiddenIndex };
  });

  // Цена `0` или `0.000`: значащих цифр нет, но одну цифру — ноль — интерфейс показывает
  const total = Math.max(significant, 1);
  return { integer: groupInteger(integer), fraction, significant: total, shown: total - hiddenCount };
}
