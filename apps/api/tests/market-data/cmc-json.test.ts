import { isObject, parseCmcJson } from '../../src/market-data/cmc-json.ts';

describe('parseCmcJson: цена исходным текстом (ADR 0006)', () => {
  it('обычный JSON.parse теряет цифры — reviver с context.source нет', () => {
    const text = '{"price": 67123.451234567891, "tiny": {"price": 0.0000000012345678901234}}';
    expect((JSON.parse(text) as { price: number }).price).toBe(67123.4512345679);
    expect(parseCmcJson(text)).toEqual({ price: '67123.451234567891', tiny: { price: '0.0000000012345678901234' } });
  });

  it('прочие числа и нечисловые price не трогает', () => {
    expect(parseCmcJson('{"id": 1, "price": null, "x": {"price": "1.5"}, "cmc_rank": 2}')).toEqual({
      id: 1,
      price: null,
      x: { price: '1.5' },
      cmc_rank: 2,
    });
  });

  it('экспонента сохраняется как есть — её развернёт Decimal.parse', () => {
    expect(parseCmcJson('{"price": 1.2e-9}')).toEqual({ price: '1.2e-9' });
  });

  it('битый JSON — исключение', () => {
    expect(() => parseCmcJson('{')).toThrow(SyntaxError);
  });

  it('isObject: только не-null объекты, не массивы', () => {
    expect([{}, [], null, 1, 'x'].map(isObject)).toEqual([true, false, false, false, false]);
  });
});
