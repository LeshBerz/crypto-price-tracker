// Точная десятичная арифметика для цен (ADR 0006): значение = units / 10^scale, units — BigInt.
// Без float: 0.1 + 0.2 = 0.3 ровно. Округление всегда явное, по умолчанию банковское (HALF_EVEN).

/**
 * HALF_EVEN — банковское: ровно половина округляется к чётной цифре (2.5 → 2, 3.5 → 4), смещение
 * в сумме многих округлений не накапливается. HALF_UP — «школьное»: половина — от нуля (2.5 → 3).
 */
export type RoundingMode = 'HALF_EVEN' | 'HALF_UP';

export class DecimalError extends Error {
  override name = 'DecimalError';
}

// Целая часть обязательна, дробная — если есть точка, то с цифрами: '12.' и '.5' отклоняются
const NUMBER = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
/** Защита от «1e1000000»: развернуть такую экспоненту — мегабайты нулей */
const MAX_EXPONENT = 100;
const MAX_INPUT_LENGTH = 100;
/** Максимальная длина цены — как в контракте (Decimal.maxLength) и CHECK в БД */
export const MAX_PRICE_LENGTH = 40;

const pow10 = (n: number): bigint => 10n ** BigInt(n);
const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** n / d с округлением; d > 0 */
function divideRounded(n: bigint, d: bigint, mode: RoundingMode): bigint {
  const quotient = n / d; // BigInt-деление отбрасывает дробь (к нулю)
  const remainder = n % d;
  if (remainder === 0n) return quotient;

  const awayFromZero = quotient + (n < 0n ? -1n : 1n);
  const twiceRemainder = 2n * abs(remainder);
  if (twiceRemainder > d) return awayFromZero;
  if (twiceRemainder < d) return quotient;
  // Ровно половина
  if (mode === 'HALF_UP') return awayFromZero;
  return quotient % 2n === 0n ? quotient : awayFromZero;
}

export class Decimal {
  readonly #units: bigint;
  readonly #scale: number;

  private constructor(units: bigint, scale: number) {
    // Каноническая форма: без хвостовых нулей дробной части. Тогда равные числа равны и по полям
    while (scale > 0 && units % 10n === 0n) {
      units /= 10n;
      scale -= 1;
    }
    this.#units = units;
    this.#scale = units === 0n ? 0 : scale;
  }

  static readonly ZERO = new Decimal(0n, 0);

  /** Целое число units, сдвинутое на scale знаков: of(12345n, 2) = 123.45 */
  static of(units: bigint, scale = 0): Decimal {
    if (!Number.isInteger(scale) || scale < 0) throw new DecimalError(`Недопустимый масштаб: ${scale}`);
    return new Decimal(units, scale);
  }

  /** Разбирает '123.45', '-0.5', '1.2e-9'. Экспонента разворачивается, хвостовые нули отбрасываются */
  static parse(text: string): Decimal {
    const match = text.length <= MAX_INPUT_LENGTH ? NUMBER.exec(text) : null;
    if (!match) throw new DecimalError(`Не десятичное число: '${text.slice(0, 50)}'`);
    const [, minus, integer, fraction = '', exponentText = '0'] = match;
    const exponent = Number(exponentText);
    if (Math.abs(exponent) > MAX_EXPONENT) throw new DecimalError(`Слишком большая экспонента: ${exponentText}`);

    const digits = BigInt(`${integer}${fraction}`);
    const units = minus ? -digits : digits;
    const scale = fraction.length - exponent;
    return scale >= 0 ? new Decimal(units, scale) : new Decimal(units * pow10(-scale), 0);
  }

  get scale(): number {
    return this.#scale;
  }

  isZero(): boolean {
    return this.#units === 0n;
  }

  isNegative(): boolean {
    return this.#units < 0n;
  }

  negate(): Decimal {
    return new Decimal(-this.#units, this.#scale);
  }

  /** Обе мантиссы к общему масштабу */
  #align(other: Decimal): [bigint, bigint, number] {
    const scale = Math.max(this.#scale, other.#scale);
    return [this.#units * pow10(scale - this.#scale), other.#units * pow10(scale - other.#scale), scale];
  }

  compare(other: Decimal): -1 | 0 | 1 {
    const [a, b] = this.#align(other);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  add(other: Decimal): Decimal {
    const [a, b, scale] = this.#align(other);
    return new Decimal(a + b, scale);
  }

  sub(other: Decimal): Decimal {
    return this.add(other.negate());
  }

  mul(other: Decimal): Decimal {
    return new Decimal(this.#units * other.#units, this.#scale + other.#scale);
  }

  /** Деление с явной точностью: результат округляется до scale знаков после запятой */
  div(other: Decimal, scale: number, mode: RoundingMode = 'HALF_EVEN'): Decimal {
    if (other.isZero()) throw new DecimalError('Деление на ноль');
    if (!Number.isInteger(scale) || scale < 0) throw new DecimalError(`Недопустимый масштаб: ${scale}`);
    // (a / 10^sa) / (b / 10^sb) · 10^scale = a · 10^(sb + scale) / (b · 10^sa)
    let numerator = this.#units * pow10(other.#scale + scale);
    let denominator = other.#units * pow10(this.#scale);
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    return new Decimal(divideRounded(numerator, denominator, mode), scale);
  }

  /** Округление до scale знаков после запятой; отрицательный scale — до десятков, сотен… */
  round(scale: number, mode: RoundingMode = 'HALF_EVEN'): Decimal {
    if (!Number.isInteger(scale)) throw new DecimalError(`Недопустимый масштаб: ${scale}`);
    if (scale >= this.#scale) return this;
    const rounded = divideRounded(this.#units, pow10(this.#scale - scale), mode);
    return scale >= 0 ? new Decimal(rounded, scale) : new Decimal(rounded * pow10(-scale), 0);
  }

  /** Округление до digits значащих цифр (ADR 0007: avg — 10 значащих цифр) */
  roundSignificant(digits: number, mode: RoundingMode = 'HALF_EVEN'): Decimal {
    if (!Number.isInteger(digits) || digits < 1) throw new DecimalError(`Недопустимое число значащих цифр: ${digits}`);
    if (this.isZero()) return this;
    const totalDigits = abs(this.#units).toString().length;
    // Позиция старшей цифры относительно точки определяет, сколько знаков после запятой оставить
    return this.round(digits - totalDigits + this.#scale, mode);
  }

  /** Каноническая запись без экспоненты и хвостовых нулей — формат Decimal/SignedDecimal контракта */
  toString(): string {
    const digits = abs(this.#units)
      .toString()
      .padStart(this.#scale + 1, '0');
    const sign = this.isNegative() ? '-' : '';
    if (this.#scale === 0) return sign + digits;
    return `${sign}${digits.slice(0, -this.#scale)}.${digits.slice(-this.#scale)}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

/**
 * Цена от CMC или из запроса: строго положительная и не длиннее 40 символов в канонической записи
 * (ADR 0006, CHECK в price_history). Иначе — DecimalError: такую точку не сохраняем.
 */
export function parsePrice(text: string): Decimal {
  const price = Decimal.parse(text);
  if (price.compare(Decimal.ZERO) <= 0) throw new DecimalError(`Цена должна быть больше нуля: '${text}'`);
  if (price.toString().length > MAX_PRICE_LENGTH) {
    throw new DecimalError(`Цена длиннее ${MAX_PRICE_LENGTH} символов: '${text.slice(0, 50)}'`);
  }
  return price;
}
