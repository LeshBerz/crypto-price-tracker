// Watchlist CRUD (F2) целиком: HTTP → роутер из спеки → сервис → SQLite, CMC — настоящий адаптер против HTTP-стаба.
// Кейсы — по таблице C8 в ROADMAP; каждый ответ сверяется с контрактом.
import request from 'supertest';
import { CmcMarketDataProvider } from '../../src/market-data/cmc-provider.ts';
import type { Database } from '../../src/db/database.ts';
import { WATCHLIST_LIMIT } from '../../src/watchlist/watchlist-service.ts';
import { startCmcStub, STUB_API_KEY, type CmcStub } from '../../scripts/cmc-stub.ts';
import { bearer, TOKENS } from '../helpers/auth.ts';
import { createTestApp, SYNC_INTERVAL_MS } from '../helpers/app.ts';
import { T0 } from '../helpers/db.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

const BASE = '/api/v1/cryptocurrencies';
const HOUR = 3_600_000;

let stub: CmcStub;
beforeAll(async () => {
  stub = await startCmcStub();
});
afterAll(() => stub.close());
beforeEach(() => {
  stub.requests.length = 0;
});

async function setup(apiKey = STUB_API_KEY) {
  const marketData = new CmcMarketDataProvider({ baseUrl: stub.url, apiKey, timeoutMs: 500, clock: new FakeClock() });
  return createTestApp({ marketData });
}

function insertCoin(db: Database, id: number, symbol: string, cmcId = id) {
  db.prepare(
    'INSERT INTO cryptocurrencies (id, cmc_id, symbol, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(BigInt(id), BigInt(cmcId), symbol, `${symbol} coin`, BigInt(T0), BigInt(T0));
}

function insertPrice(db: Database, coinId: number, price: string, fetchedAt: number) {
  db.prepare(
    'INSERT INTO price_history (cryptocurrency_id, price, source_updated_at, fetched_at) VALUES (?, ?, ?, ?)',
  ).run(BigInt(coinId), price, BigInt(fetchedAt - 1000), BigInt(fetchedAt));
}

describe(`[createCryptocurrency] POST ${BASE}`, () => {
  it('✅ 201 + Location; у однофамильцев BTC выбран лучший cmc_rank; событие watchlist.changed', async () => {
    const { app, published, clock } = await setup();
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 201);
    expect(res.headers.location).toBe(`${BASE}/${res.body.id}`);
    expect(res.body).toEqual({
      id: 1,
      cmcId: 1,
      symbol: 'BTC',
      name: 'Bitcoin',
      isPaused: false,
      lastUpdatedAt: null,
      createdAt: new Date(clock.now()).toISOString(),
      updatedAt: new Date(clock.now()).toISOString(),
      latestPrice: null,
    });
    expect(published).toEqual([
      expect.objectContaining({
        type: 'watchlist.changed',
        version: 1,
        payload: { cryptocurrencyId: 1, change: 'added' },
      }),
    ]);
  });

  it('✅ явный cmcId выбирает однофамильца', async () => {
    const { app } = await setup();
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC', cmcId: 99002 });
    expect(res).toMatchContract('createCryptocurrency', 201);
    expect(res.body).toMatchObject({ cmcId: 99002, name: 'Bitcoin Clone' });
  });

  it('❌ 409 already-tracked + conflictingId, без запроса в CMC', async () => {
    const { app, db } = await setup();
    insertCoin(db, 7, 'BTC', 1);
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 409);
    expect(res).toBeProblem(409, 'already-tracked');
    expect(res.body.conflictingId).toBe(7);
    expect(stub.requests).toEqual([]);
  });

  it('❌ 409: тот же cmcId под другим символом не добавить дважды', async () => {
    const { app, db } = await setup();
    insertCoin(db, 3, 'ETH', 99002);
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC', cmcId: 99002 });
    expect(res).toMatchContract('createCryptocurrency', 409);
    expect(res.body.conflictingId).toBe(3);
  });

  it('❌ гонка: два одновременных POST одного символа → один 201, второй 409', async () => {
    const { app } = await setup();
    const post = () => request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'ETH' });
    const statuses = (await Promise.all([post(), post()])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('❌ 422 unknown-symbol: CMC не знает символ', async () => {
    const { app, published } = await setup();
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'NOPE' });
    expect(res).toMatchContract('createCryptocurrency', 422);
    expect(res).toBeProblem(422, 'unknown-symbol');
    expect(published).toEqual([]);
  });

  it(`❌ 422 watchlist-limit-reached на ${WATCHLIST_LIMIT + 1}-й монете, кредит CMC не тратится`, async () => {
    const { app, db } = await setup();
    for (let i = 1; i <= WATCHLIST_LIMIT; i++) insertCoin(db, i, `C${i}`, 1000 + i);
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 422);
    expect(res).toBeProblem(422, 'watchlist-limit-reached');
    expect(stub.requests).toEqual([]);
  });

  it('❌ 503 upstream-unavailable + Retry-After: CMC лежит', async () => {
    const { app } = await setup();
    stub.fail({ kind: 'status', status: 503 });
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 503);
    expect(res).toBeProblem(503, 'upstream-unavailable');
    expect(res.headers['retry-after']).toBe('30');
  });

  it.each([
    ['как у CMC', '5', '5'],
    ['не меньше 1 с', '0', '1'],
    ['не больше 60 с', '3600', '60'],
  ])('❌ 503 при 429 от CMC: Retry-After %s', async (_case, cmcRetryAfter, expected) => {
    const { app } = await setup();
    stub.fail({ kind: 'status', status: 429, headers: { 'Retry-After': cmcRetryAfter } });
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 503);
    expect(res.headers['retry-after']).toBe(expected);
  });

  it('❌ 500: непредвиденная ошибка не маскируется под доменную', async () => {
    const { app } = await createTestApp(); // CMC не настроен — адаптер бросает обычный Error
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 500);
  });

  it('❌ 500 internal-error: CMC отверг наш ключ — детали только в логе', async () => {
    const { app, logs } = await setup('wrong-key');
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 500);
    expect(res.body.detail).toBe('Unexpected error. See logs by requestId');
    expect(logs()).toContainEqual(expect.objectContaining({ level: 'error', msg: 'CMC rejected our API key' }));
  });

  it.each([
    ['символ в нижнем регистре', { symbol: 'btc' }, '/body/symbol'],
    ['лишнее поле', { symbol: 'BTC', name: 'x' }, '/body/name'],
    ['число вместо строки', { symbol: 1 }, '/body/symbol'],
  ])('❌ 400 validation-error: %s', async (_case, body, path) => {
    const { app } = await setup();
    const res = await request(app).post(BASE).set(bearer(TOKENS.operator)).send(body);
    expect(res).toMatchContract('createCryptocurrency', 400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain(path);
  });

  it('❌ 415: тело не JSON', async () => {
    const { app } = await setup();
    const res = await request(app)
      .post(BASE)
      .set(bearer(TOKENS.operator))
      .set('Content-Type', 'text/plain')
      .send('BTC');
    expect(res).toMatchContract('createCryptocurrency', 415);
  });

  it('❌ 413: тело больше 16 КБ', async () => {
    const { app } = await setup();
    const res = await request(app)
      .post(BASE)
      .set(bearer(TOKENS.operator))
      .send({ symbol: 'BTC', pad: 'x'.repeat(17_000) });
    expect(res).toMatchContract('createCryptocurrency', 413);
  });

  it('❌ 403: ключ viewer не может менять watchlist', async () => {
    const { app } = await setup();
    const res = await request(app).post(BASE).set(bearer(TOKENS.viewer)).send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 403);
  });
});

describe(`[listCryptocurrencies] GET ${BASE}`, () => {
  it('✅ 200: items с cmcId, isPaused, lastUpdatedAt и последней ценой', async () => {
    const { app, db, clock } = await setup();
    insertCoin(db, 2, 'ETH', 1027);
    insertCoin(db, 1, 'BTC', 1);
    insertPrice(db, 1, '67123.451234567891', clock.now() - 60_000);
    db.prepare('UPDATE cryptocurrencies SET last_updated_at = ? WHERE id = 1').run(BigInt(clock.now() - 60_000));
    const res = await request(app).get(BASE).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listCryptocurrencies', 200);
    expect(res.body.items.map((c: { symbol: string }) => c.symbol)).toEqual(['BTC', 'ETH']);
    expect(res.body.items[0]).toMatchObject({
      cmcId: 1,
      isPaused: false,
      lastUpdatedAt: new Date(clock.now() - 60_000).toISOString(),
    });
    expect(res.body.items[1].lastUpdatedAt).toBeNull();
    expect(res.body.items[0].latestPrice.price).toBe('67123.451234567891');
    expect(res.body.items[1].latestPrice).toBeNull();
  });

  it('✅ 200: пустой watchlist', async () => {
    const { app } = await setup();
    const res = await request(app).get(BASE).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listCryptocurrencies', 200);
    expect(res.body).toEqual({ items: [] });
  });

  it('❌ 403 insufficient_scope: ключ только с ops:write', async () => {
    const { app } = await setup();
    const res = await request(app).get(BASE).set(bearer(TOKENS.opsWriteOnly));
    expect(res).toMatchContract('listCryptocurrencies', 403);
  });
});

describe(`[getCryptocurrency] GET ${BASE}/{id}`, () => {
  it('✅ 200: точная цена, изменение за сутки, свежесть', async () => {
    const { app, db, clock } = await setup();
    insertCoin(db, 1, 'MEME', 99001);
    const now = clock.now();
    insertPrice(db, 1, '0.000000001', now - 25 * HOUR); // раньше суток — не база
    insertPrice(db, 1, '0.0000000010000000000001', now - 24 * HOUR); // ровно сутки назад — база
    insertPrice(db, 1, '0.0000000012345678901234', now - 2 * SYNC_INTERVAL_MS - 1); // последняя, но устарела
    const res = await request(app).get(`${BASE}/1`).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getCryptocurrency', 200);
    expect(res.body.latestPrice).toEqual({
      price: '0.0000000012345678901234',
      currency: 'USD',
      sourceUpdatedAt: new Date(now - 2 * SYNC_INTERVAL_MS - 1001).toISOString(),
      fetchedAt: new Date(now - 2 * SYNC_INTERVAL_MS - 1).toISOString(),
      change24hPercent: '23.4568',
      isStale: true,
    });
  });

  it('✅ change24hPercent = null, если истории меньше суток; свежая цена не isStale', async () => {
    const { app, db, clock } = await setup();
    insertCoin(db, 1, 'BTC');
    insertPrice(db, 1, '100', clock.now() - 2 * SYNC_INTERVAL_MS);
    const res = await request(app).get(`${BASE}/1`).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getCryptocurrency', 200);
    expect(res.body.latestPrice).toMatchObject({ change24hPercent: null, isStale: false });
  });

  it('❌ 404 not-found', async () => {
    const { app } = await setup();
    const res = await request(app).get(`${BASE}/42`).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getCryptocurrency', 404);
    expect(res).toBeProblem(404, 'not-found');
  });

  it('❌ 400: id=abc', async () => {
    const { app } = await setup();
    const res = await request(app).get(`${BASE}/abc`).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getCryptocurrency', 400);
    expect(res.body.errors[0].path).toBe('/path/id');
  });
});

describe(`[updateCryptocurrency] PATCH ${BASE}/{id}`, () => {
  it('✅ 200: переименование (с обрезкой пробелов) и пауза; updatedAt сдвинулся; событие updated', async () => {
    const { app, db, clock, published } = await setup();
    insertCoin(db, 1, 'BTC');
    await clock.advance(5000);
    const res = await request(app)
      .patch(`${BASE}/1`)
      .set(bearer(TOKENS.operator))
      .send({ name: '  Цифровое золото ', isPaused: true });
    expect(res).toMatchContract('updateCryptocurrency', 200);
    expect(res.body).toMatchObject({
      name: 'Цифровое золото',
      isPaused: true,
      createdAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0 + 5000).toISOString(),
    });
    expect(published.map((e) => e.payload)).toEqual([{ cryptocurrencyId: 1, change: 'updated' }]);
  });

  it('✅ 200: поле, которого нет в теле, не меняется', async () => {
    const { app, db } = await setup();
    insertCoin(db, 1, 'BTC');
    await request(app).patch(`${BASE}/1`).set(bearer(TOKENS.operator)).send({ isPaused: true });
    const res = await request(app).patch(`${BASE}/1`).set(bearer(TOKENS.operator)).send({ name: 'B' });
    expect(res).toMatchContract('updateCryptocurrency', 200);
    expect(res.body).toMatchObject({ name: 'B', isPaused: true });
  });

  it.each([
    ['пустое тело (minProperties)', {}, '/body'],
    ['symbol менять нельзя (additionalProperties)', { symbol: 'ETH' }, '/body/symbol'],
    ['имя из пробелов', { name: '   ' }, '/body/name'],
  ])('❌ 400: %s', async (_case, body, path) => {
    const { app, db } = await setup();
    insertCoin(db, 1, 'BTC');
    const res = await request(app).patch(`${BASE}/1`).set(bearer(TOKENS.operator)).send(body);
    expect(res).toMatchContract('updateCryptocurrency', 400);
    expect(res.body.errors[0].path).toBe(path);
  });

  it('❌ 404', async () => {
    const { app, published } = await setup();
    const res = await request(app).patch(`${BASE}/9`).set(bearer(TOKENS.operator)).send({ isPaused: true });
    expect(res).toMatchContract('updateCryptocurrency', 404);
    expect(published).toEqual([]);
  });
});

describe(`[deleteCryptocurrency] DELETE ${BASE}/{id}`, () => {
  it('✅ 204: история удалена каскадом, событие removed', async () => {
    const { app, db, clock, published } = await setup();
    insertCoin(db, 1, 'BTC');
    insertPrice(db, 1, '100', clock.now());
    const res = await request(app).delete(`${BASE}/1`).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('deleteCryptocurrency', 204);
    expect(res.text).toBe('');
    expect(db.prepare('SELECT count(*) AS n FROM price_history').get()).toEqual({ n: 0 });
    expect(published.map((e) => e.payload)).toEqual([{ cryptocurrencyId: 1, change: 'removed' }]);
  });

  it('❌ 404', async () => {
    const { app } = await setup();
    const res = await request(app).delete(`${BASE}/1`).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('deleteCryptocurrency', 404);
  });

  it('❌ 403: ключ viewer', async () => {
    const { app, db } = await setup();
    insertCoin(db, 1, 'BTC');
    const res = await request(app).delete(`${BASE}/1`).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('deleteCryptocurrency', 403);
    expect(db.prepare('SELECT count(*) AS n FROM cryptocurrencies').get()).toEqual({ n: 1 });
  });
});
