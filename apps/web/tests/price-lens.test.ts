// «Линза точности»: разбор строки цены по цифрам без перевода в number.
import { formatPrice } from '@/lib/format';
import { lensView } from '@/lib/price-lens';

const chars = (price: string, pick: 'hidden' | 'leadingZero' | 'groupStart') =>
  lensView(price)
    .fraction.filter((digit) => digit[pick])
    .map((digit) => digit.char)
    .join('');

describe('[lensView] цена от 1 — в интерфейсе два знака после запятой', () => {
  it('✅ целая часть разбита на группы по три справа, дробная — слева', () => {
    const view = lensView('67123.451234567891');
    expect(view.integer).toBe('67 123');
    expect(view.fraction.map((digit) => digit.groupStart)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('✅ скрыты все цифры после второго знака; счётчики сходятся с длиной строки', () => {
    const view = lensView('67123.451234567891');
    expect(chars('67123.451234567891', 'hidden')).toBe('1234567891');
    expect(view).toMatchObject({ significant: 17, shown: 7 });
  });

  it('✅ короткая цена — скрытых цифр нет', () => {
    expect(lensView('2512.08')).toMatchObject({ integer: '2 512', significant: 6, shown: 6 });
    expect(lensView('5.4')).toMatchObject({ integer: '5', significant: 2, shown: 2 });
    expect(chars('2512.08', 'hidden')).toBe('');
  });

  it('✅ целое число без дробной части', () => {
    expect(lensView('67123')).toEqual({ integer: '67 123', fraction: [], significant: 5, shown: 5 });
  });

  it('✅ ноль после запятой у цены от 1 — значащая цифра, а не ведущий ноль', () => {
    expect(chars('1.005', 'leadingZero')).toBe('');
    expect(lensView('1.005')).toMatchObject({ significant: 4, shown: 3 });
  });

  it('✅ целая часть длиннее Number.MAX_SAFE_INTEGER раскладывается без потерь', () => {
    const view = lensView('123456789012345678.123');
    expect(view.integer).toBe('123 456 789 012 345 678');
    expect(view).toMatchObject({ significant: 21, shown: 20 });
  });
});

describe('[lensView] цена меньше 1 — в интерфейсе шесть значащих цифр', () => {
  it('✅ ведущие нули дроби не значащие и не скрытые', () => {
    const price = '0.0000123456789';
    expect(chars(price, 'leadingZero')).toBe('0000');
    expect(chars(price, 'hidden')).toBe('789');
    expect(lensView(price)).toMatchObject({ integer: '0', significant: 9, shown: 6 });
  });

  it('✅ 22 знака после запятой: каждая цифра на месте', () => {
    const price = '0.0000000012345678901234';
    const view = lensView(price);
    expect(view.fraction.map((digit) => digit.char).join('')).toBe('0000000012345678901234');
    expect(view).toMatchObject({ significant: 14, shown: 6 });
    expect(chars(price, 'hidden')).toBe('78901234');
  });

  it('✅ скрытые цифры пронумерованы подряд с нуля, у видимых номера нет', () => {
    const { fraction } = lensView('0.1623457');
    expect(fraction.map((digit) => digit.hiddenIndex)).toEqual([-1, -1, -1, -1, -1, -1, 0]);
  });

  it('✅ ноль внутри значащих цифр считается значащим', () => {
    expect(lensView('0.100200300')).toMatchObject({ significant: 9, shown: 6 });
    expect(chars('0.100200300', 'leadingZero')).toBe('');
  });

  it('✅ цена 0 — одна цифра, скрытых нет', () => {
    expect(lensView('0')).toEqual({ integer: '0', fraction: [], significant: 1, shown: 1 });
    expect(lensView('0.000')).toMatchObject({ significant: 1, shown: 1 });
    expect(chars('0.000', 'leadingZero')).toBe('000');
  });
});

describe('[lensView] согласованность с formatPrice', () => {
  it.each(['67123.451234567891', '2512.08', '148.3712', '0.1623457', '0.99981234', '0.0000123456789', '1.005'])(
    '✅ %s: число показанных цифр равно числу цифр в округлённой цене',
    (price) => {
      // Ведущий ноль целой части и ведущие нули дроби значащими не считаются
      const digits = formatPrice(price).replace(/[^\d]/g, '').replace(/^0+/, '');
      expect(lensView(price).shown).toBe(digits.length);
    },
  );
});
