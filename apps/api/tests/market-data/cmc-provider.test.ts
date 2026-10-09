// Адаптер CMC против HTTP-стаба на node:http (ADR 0009): настоящий сокет, настоящий таймаут axios, точные цены.
import { CmcMarketDataProvider, parseRetryAfter } from '../../src/market-data/cmc-provider.ts';
import { MarketDataError, type MarketDataErrorCode } from '../../src/market-data/provider.ts';
import { startCmcStub, STUB_API_KEY, type CmcStub } from '../../scripts/cmc-stub.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

const TIMEOUT_MS = 200;

describe('CmcMarketDataProvider', () => {
  let stub: CmcStub;
  let clock: FakeClock;
  let cmc: CmcMarketDataProvider;
  const make = (apiKey = STUB_API_KEY) =>
    new CmcMarketDataProvider({ baseUrl: stub.url, apiKey, timeoutMs: TIMEOUT_MS, clock });

  /** Промис должен отклониться MarketDataError с этим кодом */
  async function expectCode(promise: Promise<unknown>, code: MarketDataErrorCode): Promise<MarketDataError> {
    const error = await promise.then(
      () => {
        throw new Error('ожидалась ошибка');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MarketDataError);
    expect((error as MarketDataError).code).toBe(code);
    return error as MarketDataError;
  }

  beforeEach(async () => {
    stub = await startCmcStub();
    clock = new FakeClock();
    cmc = make();
  });
  afterEach(() => stub.close());

  describe('getQuotes', () => {
    it('✅ точные цены без потери цифр, включая 0.0000000012345678901234 (ADR 0006)', async () => {
      const result = await cmc.getQuotes([1, 99001]);
      expect(result).toEqual({
        quotes: [
          { cmcId: 1, price: '67123.451234567891', sourceUpdatedAt: Date.parse('2026-10-07T11:59:00.000Z') },
          { cmcId: 99001, price: '0.0000000012345678901234', sourceUpdatedAt: Date.parse('2026-10-07T11:59:00.000Z') },
        ],
        missing: [],
        rejected: [],
        creditsUsed: 1,
      });
    });

    it('запрос: id через запятую, convert=USD, skip_invalid, ключ — только в заголовке', async () => {
      await cmc.getQuotes([1, 1027]);
      expect(stub.requests).toEqual([
        {
          method: 'GET',
          path: '/v2/cryptocurrency/quotes/latest',
          query: { id: '1,1027', convert: 'USD', skip_invalid: 'true' },
          apiKey: STUB_API_KEY,
        },
      ]);
    });

    it('неизвестный id → missing, остальное сохраняется (partial)', async () => {
      const result = await cmc.getQuotes([1, 424242]);
      expect(result.quotes.map((q) => q.cmcId)).toEqual([1]);
      expect(result.missing).toEqual([424242]);
    });

    it('невалидная котировка одной монеты отбрасывается с причиной, батч живёт', async () => {
      const coin = (id: number) => stub.coins.find((c) => c.id === id);
      Object.assign(coin(1027) ?? {}, { price: '-5' });
      Object.assign(coin(99001) ?? {}, { lastUpdated: 'вчера' });
      stub.coins.push({
        id: 5,
        symbol: 'NOP',
        name: 'No price',
        rank: 10,
        price: null,
        lastUpdated: '2026-10-07T11:59:00.000Z',
      });
      const result = await cmc.getQuotes([1, 1027, 99001, 5]);
      expect(result.quotes.map((q) => q.cmcId)).toEqual([1]);
      expect(result.rejected).toEqual([
        { cmcId: 1027, reason: expect.stringMatching(/больше нуля/) },
        { cmcId: 99001, reason: 'no valid last_updated' },
        { cmcId: 5, reason: 'no price' },
      ]);
    });

    it('нет quote или last_updated не строка → rejected', async () => {
      stub.fail({
        kind: 'raw',
        body: '{"data":{"1":{"id":1},"2":{"quote":{"USD":{"price":1,"last_updated":5}}}}}',
      });
      expect((await cmc.getQuotes([1, 2])).rejected).toEqual([
        { cmcId: 1, reason: 'no USD quote' },
        { cmcId: 2, reason: 'no valid last_updated' },
      ]);
    });

    it('монета без quote.USD → rejected «no USD quote»', async () => {
      stub.fail({ kind: 'raw', body: '{"status":{"credit_count":"x"},"data":{"1":{"id":1,"quote":{}}}}' });
      await expect(cmc.getQuotes([1])).resolves.toEqual({
        quotes: [],
        missing: [],
        rejected: [{ cmcId: 1, reason: 'no USD quote' }],
        creditsUsed: null,
      });
    });

    it('пустой список — без запроса в CMC и без трат кредитов', async () => {
      await expect(cmc.getQuotes([])).resolves.toEqual({ quotes: [], missing: [], rejected: [], creditsUsed: 0 });
      expect(stub.requests).toEqual([]);
    });

    it('больше 100 id за раз — ошибка программиста (лимит watchlist 100)', async () => {
      await expect(cmc.getQuotes(Array.from({ length: 101 }, (_, i) => i + 1))).rejects.toThrow(RangeError);
    });
  });

  describe('классификация ошибок (ADR 0015 §4)', () => {
    it('❌ 429 + Retry-After → CMC_RATE_LIMITED, ретраибельна, retryAfterMs из заголовка', async () => {
      stub.fail({ kind: 'status', status: 429, headers: { 'Retry-After': '7' } });
      const error = await expectCode(cmc.getQuotes([1]), 'CMC_RATE_LIMITED');
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBe(7000);
    });

    it('❌ 429 без Retry-After → retryAfterMs не задан (будет обычный backoff)', async () => {
      stub.fail({ kind: 'status', status: 429 });
      expect((await expectCode(cmc.getQuotes([1]), 'CMC_RATE_LIMITED')).retryAfterMs).toBeUndefined();
    });

    it.each([500, 502, 503])('❌ %i → CMC_UNAVAILABLE, ретраибельна', async (status) => {
      stub.fail({ kind: 'status', status, body: '<html>Bad Gateway</html>' });
      const error = await expectCode(cmc.getQuotes([1]), 'CMC_UNAVAILABLE');
      expect(error.retryable).toBe(true);
      expect(error.message).toBe(`CMC answered HTTP ${status}: no error message`);
    });

    it('❌ неверный ключ → 401 → CMC_AUTH, не ретраится; текст ошибки CMC сохранён', async () => {
      const error = await expectCode(make('wrong-key').getQuotes([1]), 'CMC_AUTH');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('CMC answered HTTP 401: This API Key is invalid.');
      expect(error.message).not.toContain('wrong-key');
    });

    it.each([402, 403])('❌ %i (план) → CMC_AUTH', async (status) => {
      stub.fail({ kind: 'status', status });
      await expectCode(cmc.getQuotes([1]), 'CMC_AUTH');
    });

    it.each([
      ['status не объект', '{"status": "x"}'],
      ['пустое сообщение', '{"status": {"error_message": ""}}'],
      ['без status', '[]'],
    ])('тело ошибки без текста (%s) → общий текст', async (_case, body) => {
      stub.fail({ kind: 'status', status: 500, body });
      expect((await expectCode(cmc.getQuotes([1]), 'CMC_UNAVAILABLE')).message).toBe(
        'CMC answered HTTP 500: no error message',
      );
    });

    it('❌ прочий 4xx → CMC_BAD_RESPONSE, не ретраится', async () => {
      stub.fail({ kind: 'status', status: 400 });
      expect((await expectCode(cmc.getQuotes([1]), 'CMC_BAD_RESPONSE')).retryable).toBe(false);
    });

    it('❌ обрыв соединения → CMC_UNAVAILABLE', async () => {
      stub.fail({ kind: 'drop' });
      const error = await expectCode(cmc.getQuotes([1]), 'CMC_UNAVAILABLE');
      expect(error.message).toMatch(/^CMC connection failed: /);
    });

    it('❌ CMC не отвечает → настоящий таймаут axios → CMC_TIMEOUT', async () => {
      stub.fail({ kind: 'hang' });
      const started = performance.now();
      const error = await expectCode(cmc.getQuotes([1]), 'CMC_TIMEOUT');
      expect(performance.now() - started).toBeGreaterThanOrEqual(TIMEOUT_MS - 20);
      expect(error.message).toBe(`CMC did not respond within ${TIMEOUT_MS} ms`);
      expect(error.retryable).toBe(true);
    });

    it('❌ сервер недоступен (порт закрыт) → CMC_UNAVAILABLE', async () => {
      const url = stub.url;
      await stub.close();
      const offline = new CmcMarketDataProvider({ baseUrl: url, apiKey: STUB_API_KEY, timeoutMs: TIMEOUT_MS, clock });
      await expectCode(offline.getQuotes([1]), 'CMC_UNAVAILABLE');
      stub = await startCmcStub();
    });

    it.each([
      ['битый JSON', '{"data": {'],
      ['нет data', '{"status": {}}'],
      ['data — массив', '{"data": []}'],
    ])('❌ %s → CMC_BAD_RESPONSE', async (_case, body) => {
      stub.fail({ kind: 'raw', body });
      expect((await expectCode(cmc.getQuotes([1]), 'CMC_BAD_RESPONSE')).retryable).toBe(false);
    });

    it('отмена через AbortSignal (shutdown) пробрасывает причину отмены, а не код CMC', async () => {
      stub.fail({ kind: 'hang' });
      const controller = new AbortController();
      const reason = new Error('shutdown');
      const pending = cmc.getQuotes([1], controller.signal);
      setTimeout(() => controller.abort(reason), 20);
      await expect(pending).rejects.toBe(reason);
    });

    it('не-axios ошибка не маскируется под ошибку CMC', async () => {
      const broken = new CmcMarketDataProvider({ baseUrl: 'http://[bad', apiKey: 'k', timeoutMs: 100, clock });
      const error = await broken.getQuotes([1]).catch((e: unknown) => e);
      expect(error).not.toBeInstanceOf(MarketDataError);
    });
  });

  describe('resolveSymbol (ADR 0013 №2)', () => {
    it('✅ однофамильцы BTC → активная монета с лучшим cmc_rank', async () => {
      await expect(cmc.resolveSymbol('BTC')).resolves.toEqual({ cmcId: 1, symbol: 'BTC', name: 'Bitcoin' });
      expect(stub.requests[0]?.query).toEqual({ symbol: 'BTC' });
    });

    it('монета без ранга уступает ранжированной; при равенстве — меньший id', async () => {
      stub.coins.push(
        { id: 7, symbol: 'DUP', name: 'No rank', rank: null, price: '1', lastUpdated: '2026-10-07T11:59:00.000Z' },
        {
          id: 9,
          symbol: 'DUP',
          name: 'Ranked later id',
          rank: 50,
          price: '1',
          lastUpdated: '2026-10-07T11:59:00.000Z',
        },
        { id: 8, symbol: 'DUP', name: 'Ranked', rank: 50, price: '1', lastUpdated: '2026-10-07T11:59:00.000Z' },
      );
      await expect(cmc.resolveSymbol('DUP')).resolves.toMatchObject({ cmcId: 8, name: 'Ranked' });
    });

    it('✅ явный cmcId выбирает однофамильца', async () => {
      await expect(cmc.resolveSymbol('BTC', 99002)).resolves.toEqual({
        cmcId: 99002,
        symbol: 'BTC',
        name: 'Bitcoin Clone',
      });
      expect(stub.requests[0]?.query).toEqual({ id: '99002', skip_invalid: 'true' });
    });

    it('❌ неизвестный символ (CMC отвечает 400) → CMC_UNKNOWN_SYMBOL', async () => {
      const error = await expectCode(cmc.resolveSymbol('NOPE'), 'CMC_UNKNOWN_SYMBOL');
      expect(error.retryable).toBe(false);
    });

    it('❌ есть только неактивные монеты → CMC_UNKNOWN_SYMBOL', async () => {
      stub.coins.push({
        id: 11,
        symbol: 'OLD',
        name: 'Old',
        rank: null,
        isActive: false,
        price: null,
        lastUpdated: '2026-10-07T11:59:00.000Z',
      });
      await expectCode(cmc.resolveSymbol('OLD'), 'CMC_UNKNOWN_SYMBOL');
    });

    it('❌ ответ без массива под символом → CMC_UNKNOWN_SYMBOL', async () => {
      stub.fail({ kind: 'raw', body: '{"data": {}}' });
      await expectCode(cmc.resolveSymbol('BTC'), 'CMC_UNKNOWN_SYMBOL');
    });

    it.each([
      ['cmcId несуществующий', 'ETH', 424242],
      ['cmcId чужого символа', 'ETH', 1],
    ])('❌ %s → CMC_UNKNOWN_SYMBOL', async (_case, symbol, cmcId) => {
      await expectCode(cmc.resolveSymbol(symbol, cmcId), 'CMC_UNKNOWN_SYMBOL');
    });

    it('❌ имя не строка → CMC_BAD_RESPONSE', async () => {
      stub.fail({ kind: 'raw', body: '{"data": {"X": [{"id": 3, "is_active": 1, "name": 42}]}}' });
      await expectCode(cmc.resolveSymbol('X'), 'CMC_BAD_RESPONSE');
    });

    it('❌ у монеты нет имени → CMC_BAD_RESPONSE', async () => {
      stub.fail({ kind: 'raw', body: '{"data": {"X": [{"id": 3, "is_active": 1, "cmc_rank": 1, "name": " "}]}}' });
      await expectCode(cmc.resolveSymbol('X'), 'CMC_BAD_RESPONSE');
    });

    it('слишком длинное имя обрезается до 100 символов (CHECK в схеме)', async () => {
      stub.coins.push({
        id: 12,
        symbol: 'LONG',
        name: 'N'.repeat(150),
        rank: 1,
        price: '1',
        lastUpdated: '2026-10-07T11:59:00.000Z',
      });
      expect((await cmc.resolveSymbol('LONG')).name).toHaveLength(100);
    });
  });

  describe('getUsage', () => {
    it('✅ кредиты из key/info', async () => {
      await expect(cmc.getUsage()).resolves.toEqual({
        creditLimitMonthly: 10_000,
        creditsUsedMonth: 120,
        creditsLeftMonth: 9880,
        creditsUsedToday: 7,
      });
      expect(stub.requests[0]?.path).toBe('/v1/key/info');
    });

    it.each([
      ['пустой data', '{"data": {}}'],
      [
        'дробь и отрицательное',
        '{"data": {"plan": {"credit_limit_monthly": 1.5}, "usage": {"current_day": {"credits_used": -1}}}}',
      ],
    ])('❌ %s → CMC_BAD_RESPONSE с перечнем полей', async (_case, body) => {
      stub.fail({ kind: 'raw', body });
      const error = await expectCode(cmc.getUsage(), 'CMC_BAD_RESPONSE');
      expect(error.message).toMatch(/creditLimitMonthly, creditsUsedMonth, creditsLeftMonth, creditsUsedToday$/);
    });
  });
});

describe('parseRetryAfter (RFC 9110 §10.2.3)', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  it.each([
    ['30', 30_000],
    [' 0 ', 0],
    ['Wed, 07 Oct 2026 12:00:45 GMT', 45_000],
    ['Wed, 07 Oct 2026 11:00:00 GMT', 0],
    ['soon', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('%j → %j', (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });
});
