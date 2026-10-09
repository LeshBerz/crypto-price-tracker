// Ретраи на FakeClock (ADR 0009): число попыток, backoff с jitter, потолок Retry-After — без реального ожидания.
import { MarketDataError } from '../../src/market-data/provider.ts';
import { backoffDelay, withRetry } from '../../src/market-data/retry.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

const unavailable = () => new MarketDataError('CMC_UNAVAILABLE', 'down');

describe('backoffDelay', () => {
  it('удваивается от base, упирается в cap, jitter — от 50 до 100 %', () => {
    const max = () => 0.999999;
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, 1000, 30_000, max))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000,
    ]);
    expect(backoffDelay(3, 1000, 30_000, () => 0)).toBe(2000);
    expect(backoffDelay(3, 1000, 30_000, () => 0.5)).toBe(3000);
  });
});

describe('withRetry', () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = new FakeClock();
  });

  it('✅ успех с первой попытки — без ожиданий', async () => {
    const fn = jest.fn(async () => 'ok');
    await expect(withRetry(fn, { clock })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('✅ ретраибельная ошибка → ждёт backoff через Clock и повторяет', async () => {
    const delays: number[] = [];
    const fn = jest.fn(async (attempt: number) => {
      if (attempt < 3) throw unavailable();
      return attempt;
    });
    const result = withRetry(fn, { clock, random: () => 0, onRetry: ({ delayMs }) => delays.push(delayMs) });
    await clock.advance(0);
    expect(clock.pendingSleeps).toBe(1); // ушёл в ожидание, а не крутит цикл
    await clock.advance(10_000);
    await expect(result).resolves.toBe(3);
    expect(delays).toEqual([500, 1000]);
  });

  it('❌ после всех попыток пробрасывает последнюю ошибку', async () => {
    const fn = jest.fn(async () => {
      throw unavailable();
    });
    const result = withRetry(fn, { clock, attempts: 3 });
    const assertion = expect(result).rejects.toThrow('down');
    await clock.advance(60_000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it.each(['CMC_AUTH', 'CMC_BAD_RESPONSE', 'CMC_UNKNOWN_SYMBOL'] as const)('❌ %s не ретраится', async (code) => {
    const fn = jest.fn(async () => {
      throw new MarketDataError(code, 'no');
    });
    await expect(withRetry(fn, { clock })).rejects.toMatchObject({ code });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('❌ чужая ошибка (не MarketDataError) не ретраится', async () => {
    const fn = jest.fn(async () => {
      throw new TypeError('bug');
    });
    await expect(withRetry(fn, { clock })).rejects.toThrow(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('429: ждёт Retry-After без jitter, но не дольше 60 с', async () => {
    const delays: number[] = [];
    const errors = [
      new MarketDataError('CMC_RATE_LIMITED', '429', { retryAfterMs: 5000 }),
      new MarketDataError('CMC_RATE_LIMITED', '429', { retryAfterMs: 3_600_000 }),
    ];
    const fn = async () => {
      const error = errors.shift();
      if (error) throw error;
      return 'ok';
    };
    const result = withRetry(fn, { clock, onRetry: ({ delayMs }) => delays.push(delayMs) });
    await clock.advance(65_000);
    await expect(result).resolves.toBe('ok');
    expect(delays).toEqual([5000, 60_000]);
  });

  it('отмена во время ожидания прерывает ретраи (shutdown)', async () => {
    const controller = new AbortController();
    const fn = jest.fn(async () => {
      throw unavailable();
    });
    const result = withRetry(fn, { clock, signal: controller.signal });
    await clock.advance(0);
    controller.abort(new Error('shutdown'));
    await expect(result).rejects.toThrow('shutdown');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
