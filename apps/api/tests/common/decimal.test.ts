// Decimal — критичный код (ADR 0006, 0009): 100 % покрытия и все граничные случаи.
import { Decimal, DecimalError, parsePrice } from '../../src/common/decimal.ts';

const d = (text: string) => Decimal.parse(text);
const s = (value: Decimal) => value.toString();

// Паттерны контракта (openapi.yaml: Decimal, SignedDecimal) — вывод toString обязан им соответствовать
const SIGNED_DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;

describe('Decimal.parse → toString', () => {
  it.each([
    ['0', '0'],
    ['00', '0'],
    ['-0', '0'], // ноль без знака: «-0» в ответе API недопустим
    ['0.000', '0'],
    ['100', '100'],
    ['007.50', '7.5'],
    ['67123.451234567891', '67123.451234567891'],
    ['0.0000000012345678901234', '0.0000000012345678901234'],
    ['-1.2345', '-1.2345'],
    ['1.2e-9', '0.0000000012'],
    ['1.2E-9', '0.0000000012'],
    ['1.5e3', '1500'],
    ['1.25e+1', '12.5'],
    ['-2e2', '-200'],
    ['123456789012345678901234567890.123456789', '123456789012345678901234567890.123456789'],
  ])('%s → %s', (input, output) => {
    const value = d(input);
    expect(s(value)).toBe(output);
    expect(s(value)).toMatch(SIGNED_DECIMAL);
  });

  it.each(['', ' 1', '1 ', '+1', '1.', '.5', '1.2.3', 'abc', 'NaN', 'Infinity', '1e', '1,5', '0x10', '1_000'])(
    '❌ отклоняет %p',
    (input) => {
      expect(() => d(input)).toThrow(DecimalError);
    },
  );

  it('❌ отклоняет огромную экспоненту — защита от разворачивания в мегабайты нулей', () => {
    expect(() => d('1e1000000')).toThrow(/экспонента/);
    expect(s(d('1e100'))).toHaveLength(101);
  });

  it('❌ отклоняет слишком длинный ввод', () => {
    expect(() => d('1'.repeat(101))).toThrow(DecimalError);
  });

  it('toJSON отдаёт строку: цена в JSON — всегда string (ADR 0006)', () => {
    expect(JSON.stringify({ price: d('0.10') })).toBe('{"price":"0.1"}');
  });

  it('Decimal.of собирает число из мантиссы и масштаба', () => {
    expect(s(Decimal.of(12345n, 2))).toBe('123.45');
    expect(s(Decimal.of(7n))).toBe('7');
    expect(Decimal.of(1200n, 2).scale).toBe(0); // 12.00 → 12
    expect(() => Decimal.of(1n, -1)).toThrow(DecimalError);
    expect(() => Decimal.of(1n, 1.5)).toThrow(DecimalError);
  });
});

describe('арифметика', () => {
  it('0.1 + 0.2 = 0.3 ровно (во float — 0.30000000000000004)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(s(d('0.1').add(d('0.2')))).toBe('0.3');
  });

  it('сложение и вычитание с разным масштабом', () => {
    expect(s(d('67123.45').add(d('0.000000001')))).toBe('67123.450000001');
    expect(s(d('1').sub(d('1.000000000000000000001')))).toBe('-0.000000000000000000001');
    expect(s(d('5.5').sub(d('5.5')))).toBe('0');
  });

  it('умножение складывает масштабы и убирает хвостовые нули', () => {
    expect(s(d('1.5').mul(d('2')))).toBe('3');
    expect(s(d('-0.001').mul(d('0.002')))).toBe('-0.000002');
    expect(s(d('99999999999999999999').mul(d('99999999999999999999')))).toBe(
      '9999999999999999999800000000000000000001',
    );
  });

  it('сравнение не зависит от записи', () => {
    expect(d('9.5').compare(d('10.25'))).toBe(-1); // лексикографически '9.5' > '10.25' — ловушка TEXT (ADR 0006)
    expect(d('10.25').compare(d('9.5'))).toBe(1);
    expect(d('1.50').compare(d('1.5'))).toBe(0);
    expect(d('1.50').equals(d('1.5'))).toBe(true);
    expect(d('-1').compare(d('0'))).toBe(-1);
  });

  it('знак, ноль, смена знака', () => {
    expect(d('-3').isNegative()).toBe(true);
    expect(d('3').isNegative()).toBe(false);
    expect(d('0.000').isZero()).toBe(true);
    expect(s(d('3').negate())).toBe('-3');
    expect(s(Decimal.ZERO.negate())).toBe('0');
  });
});

describe('деление с явной точностью', () => {
  it('1 / 3 до 4 знаков', () => {
    expect(s(d('1').div(d('3'), 4))).toBe('0.3333');
    expect(s(d('2').div(d('3'), 4))).toBe('0.6667');
  });

  it('знаки делимого и делителя', () => {
    expect(s(d('-1').div(d('3'), 2))).toBe('-0.33');
    expect(s(d('1').div(d('-3'), 2))).toBe('-0.33');
    expect(s(d('-1').div(d('-3'), 2))).toBe('0.33');
    expect(s(d('-2').div(d('-3'), 2))).toBe('0.67');
  });

  it('учитывает масштаб обоих операндов', () => {
    expect(s(d('0.0012').div(d('0.04'), 6))).toBe('0.03');
    expect(s(d('67000').div(d('0.5'), 0))).toBe('134000');
  });

  it('% изменения: (close − open) / open × 100, 4 знака, HALF_EVEN (ADR 0007)', () => {
    const open = d('60000.5');
    const close = d('59990');
    expect(s(close.sub(open).mul(d('100')).div(open, 4))).toBe('-0.0175');
  });

  it('❌ деление на ноль и недопустимый масштаб', () => {
    expect(() => d('1').div(d('0'), 2)).toThrow(/ноль/);
    expect(() => d('1').div(d('3'), -1)).toThrow(DecimalError);
  });
});

describe('округление', () => {
  // HALF_EVEN: ровно половина — к чётной цифре; HALF_UP — от нуля
  it.each([
    ['2.5', 0, '2', '3'],
    ['3.5', 0, '4', '4'],
    ['-2.5', 0, '-2', '-3'],
    ['-3.5', 0, '-4', '-4'],
    ['2.51', 0, '3', '3'],
    ['2.49', 0, '2', '2'],
    ['-2.51', 0, '-3', '-3'],
    ['0.125', 2, '0.12', '0.13'],
    ['0.135', 2, '0.14', '0.14'],
    ['9.995', 2, '10', '10'],
    ['1250', -2, '1200', '1300'],
    ['1350', -2, '1400', '1400'],
  ])('%s до %i знаков: HALF_EVEN %s, HALF_UP %s', (input, scale, halfEven, halfUp) => {
    expect(s(d(input).round(scale))).toBe(halfEven);
    expect(s(d(input).round(scale, 'HALF_UP'))).toBe(halfUp);
  });

  it('не трогает число, если знаков уже не больше нужного', () => {
    const value = d('1.25');
    expect(value.round(2)).toBe(value);
    expect(value.round(5)).toBe(value);
  });

  it('❌ дробный масштаб', () => {
    expect(() => d('1.25').round(1.5)).toThrow(DecimalError);
  });

  it('деление делает HALF_EVEN по умолчанию: 1 / 8 = 0.125 → 0.12', () => {
    expect(s(d('1').div(d('8'), 2))).toBe('0.12');
    expect(s(d('1').div(d('8'), 2, 'HALF_UP'))).toBe('0.13');
  });
});

describe('значащие цифры (avg — 10 значащих, ADR 0007)', () => {
  it.each([
    ['67123.4512345679', '67123.45123'],
    ['0.0000000012345678901234', '0.00000000123456789'], // 1234567890 → хвостовой 0 убран
    ['123456789012345', '123456789000000'],
    ['9.9999999999', '10'],
    ['-1234.56789012345', '-1234.56789'],
    ['42', '42'],
    ['0', '0'],
  ])('%s → %s', (input, output) => {
    expect(s(d(input).roundSignificant(10))).toBe(output);
  });

  it('avg из double: String(x) даёт кратчайшую точную запись, дальше — Decimal', () => {
    const avg = (60000.5 + 59990 + 60010.25) / 3;
    expect(s(d(String(avg)).roundSignificant(10))).toBe('60000.25');
  });

  it.each([0, -1, 1.5])('❌ недопустимое число значащих цифр %p', (digits) => {
    expect(() => d('1').roundSignificant(digits)).toThrow(DecimalError);
  });
});

describe('parsePrice', () => {
  it.each(['67123.451234567891', '0.0000000012345678901234', '100', '1.2e-9'])('✅ принимает %s', (input) => {
    expect(parsePrice(input).isNegative()).toBe(false);
  });

  it.each(['0', '0.000', '-5', 'abc'])('❌ отклоняет %p', (input) => {
    expect(() => parsePrice(input)).toThrow(DecimalError);
  });

  it('❌ отклоняет цену длиннее 40 символов (как CHECK в БД и maxLength в контракте)', () => {
    expect(parsePrice('0.' + '1'.repeat(38)).toString()).toHaveLength(40);
    expect(() => parsePrice('0.' + '1'.repeat(39))).toThrow(/40/);
    expect(() => parsePrice('1e-45')).toThrow(/40/);
  });
});
