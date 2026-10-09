import { changePercent, toLatestPrice } from '../../src/prices/latest-price.ts';

describe('changePercent: точно, 4 знака, HALF_EVEN (ADR 0006, 0007)', () => {
  it.each([
    ['100', '110', '10'],
    ['110', '100', '-9.0909'],
    ['0.1', '0.3', '200'],
    ['3', '3', '0'],
    // 0.00005 % ровно посередине → к чётной цифре 0
    ['2000000', '2000001', '0'],
    ['2000000', '2000003', '0.0002'],
  ])('%s → %s = %s %%', (from, to, expected) => {
    expect(changePercent(from, to)).toBe(expected);
  });
});

describe('toLatestPrice', () => {
  const row = { cryptocurrencyId: 1, price: '2', sourceUpdatedAt: 1000, fetchedAt: 2000, priceDayAgo: '1' };

  it('isStale — строго больше двух интервалов', () => {
    expect(toLatestPrice(row, 2000 + 200, 100).isStale).toBe(false);
    expect(toLatestPrice(row, 2000 + 201, 100).isStale).toBe(true);
  });

  it('время — ISO UTC, валюта — USD', () => {
    expect(toLatestPrice(row, 2000, 100)).toEqual({
      price: '2',
      currency: 'USD',
      sourceUpdatedAt: '1970-01-01T00:00:01.000Z',
      fetchedAt: '1970-01-01T00:00:02.000Z',
      change24hPercent: '100',
      isStale: false,
    });
  });
});
