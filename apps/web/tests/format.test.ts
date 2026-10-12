import { compareDecimal, formatChange, formatPrice, formatRelative, plural, splitPrice } from '@/lib/format';
import { sparklineGeometry } from '@/lib/sparkline';

describe('[format] цена — строка на входе, без перевода в number', () => {
  it.each([
    ['67123.45', '$67,123.45'],
    ['67123.456', '$67,123.46'],
    ['1', '$1.00'],
    ['0.5', '$0.50'],
    ['0.123456789', '$0.123457'],
    ['0.000012345678', '$0.0000123457'],
    ['0.99999999', '$1.00'],
    ['0', '$0.00'],
  ])('✅ %s → %s', (price, expected) => {
    expect(formatPrice(price)).toBe(expected);
  });

  it('✅ число длиннее точности double форматируется без потерь', () => {
    // Number('123456789012345678.12') дал бы 123456789012345680
    expect(formatPrice('123456789012345678.12')).toBe('$123,456,789,012,345,678.12');
  });

  it('✅ ведущие нули мелкой цены выделяются в отдельную часть', () => {
    expect(splitPrice('$0.0000123457')).toEqual({ head: '$0.', zeros: '0000', tail: '123457' });
  });

  it('✅ обычная цена и цена с одним-двумя нулями не делятся', () => {
    expect(splitPrice('$67,123.45')).toEqual({ head: '$67,123.45', zeros: '', tail: '' });
    expect(splitPrice('$0.00123457')).toEqual({ head: '$0.00123457', zeros: '', tail: '' });
  });
});

describe('[format] изменение за 24 ч', () => {
  it.each([
    ['1.234', '+1.23%', 'up'],
    ['-0.4', '−0.40%', 'down'],
    ['0', '0.00%', 'flat'],
    // Округляется до нуля: стрелки и цвета нет, знак не показывается
    ['-0.001', '0.00%', 'flat'],
  ])('✅ %s → %s (%s)', (change, text, direction) => {
    expect(formatChange(change)).toEqual({ text, direction });
  });
});

describe('[format] сравнение Decimal', () => {
  it.each([
    ['67130.1', '67123.45', 1],
    ['9.99', '10', -1],
    ['0.1', '0.10', 0],
    ['0.0000124', '0.00001235', 1],
    ['100', '100.000001', -1],
    // В double эти два значения неразличимы
    ['123456789012345678.12', '123456789012345678.11', 1],
  ])('✅ %s и %s → %i', (a, b, expected) => {
    expect(compareDecimal(a, b)).toBe(expected);
  });
});

describe('[format] время и склонение', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');

  it.each([
    ['2026-10-12T11:59:30Z', 'только что'],
    ['2026-10-12T11:58:00Z', '2 мин назад'],
    ['2026-10-12T09:00:00Z', '3 ч назад'],
    ['2026-10-10T12:00:00Z', '2 дн назад'],
    // Часы клиента отстают от сервера
    ['2026-10-12T12:00:05Z', 'только что'],
  ])('✅ %s → %s', (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });

  it('✅ склонение по правилам русского языка', () => {
    const forms = ['монета', 'монеты', 'монет'] as const;
    expect([1, 2, 5, 11, 21, 22].map((count) => plural(count, forms))).toEqual([
      'монета',
      'монеты',
      'монет',
      'монет',
      'монета',
      'монеты',
    ]);
  });
});

describe('[sparkline] геометрия мини-графика', () => {
  const points = (...closes: string[]) =>
    closes.map((close, index) => ({ bucketStart: `2026-10-12T${String(index).padStart(2, '0')}:00:00Z`, close }));

  it('✅ путь растянут на всю ширину, максимум — вверху, минимум — внизу', () => {
    const geometry = sparklineGeometry(points('100', '110', '105'), 104, 30);

    expect(geometry?.path).toBe('M1.0,27.0L52.0,3.0L103.0,15.0');
    expect(geometry?.trend).toBe('up');
  });

  it('✅ падение и «шум» меньше 0,1 %', () => {
    expect(sparklineGeometry(points('100', '90'), 104, 30)?.trend).toBe('down');
    expect(sparklineGeometry(points('1.0001', '1.0002', '1.0003'), 104, 30)?.trend).toBe('flat');
  });

  it('✅ одинаковые значения — горизонтальная линия, без деления на ноль', () => {
    expect(sparklineGeometry(points('5', '5'), 104, 30)?.path).toBe('M1.0,27.0L103.0,27.0');
  });

  it('❌ меньше двух точек — графика нет', () => {
    expect(sparklineGeometry(points('100'), 104, 30)).toBeNull();
    expect(sparklineGeometry([], 104, 30)).toBeNull();
  });
});
