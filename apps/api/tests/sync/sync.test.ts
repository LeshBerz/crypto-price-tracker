// Синхронизация цен (F6, F7, D10) целиком: HTTP → SyncService → SQLite :memory:. CMC — настоящий адаптер
// против HTTP-стаба; там, где нужен контроль над моментом ответа (наложение, прерывание), — фейк порта.
// Кейсы — по таблице C8 в ROADMAP; каждый ответ сверяется с контрактом.
import request from 'supertest';
import type { Database } from '../../src/db/database.ts';
import { CmcMarketDataProvider } from '../../src/market-data/cmc-provider.ts';
import type { MarketDataProvider, Quote, QuotesResult } from '../../src/market-data/provider.ts';
import type { SyncRunRecord } from '../../src/sync/sync-run-repository.ts';
import { INTERNAL_CODE, PARTIAL_CODE, SyncService } from '../../src/sync/sync-service.ts';
import type { UnitOfWork } from '../../src/unit-of-work.ts';
import { DEFAULT_COINS, startCmcStub, STUB_API_KEY, type CmcStub, type StubCoin } from '../../scripts/cmc-stub.ts';
import { bearer, TOKENS } from '../helpers/auth.ts';
import { createTestApp, unconfiguredMarketData } from '../helpers/app.ts';
import { T0 } from '../helpers/db.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

const RUNS = '/api/v1/sync-runs';
const MINUTE = 60_000;
const HOUR = 3_600_000;
const BTC = 1;
const ETH = 1027;
const iso = (ms: number) => new Date(ms).toISOString();

let stub: CmcStub;
afterEach(async () => {
  await stub?.close();
});

/** Приложение с настоящим CMC-адаптером против свежего стаба: монеты стаба можно менять, не задевая соседей */
async function setupWithStub(coins: StubCoin[] = DEFAULT_COINS.map((coin) => ({ ...coin }))) {
  stub = await startCmcStub({ coins });
  const marketData = new CmcMarketDataProvider({
    baseUrl: stub.url,
    apiKey: STUB_API_KEY,
    timeoutMs: 500,
    clock: new FakeClock(),
  });
  return createTestApp({ marketData });
}

const USAGE = { creditLimitMonthly: 10_000, creditsUsedMonth: 120, creditsLeftMonth: 9880, creditsUsedToday: 7 };

function fakeMarket(getQuotes: MarketDataProvider['getQuotes']): MarketDataProvider {
  return { ...unconfiguredMarketData, getQuotes, getUsage: () => Promise.resolve(USAGE) };
}

const quotes = (...items: Quote[]): QuotesResult => ({ quotes: items, missing: [], rejected: [], creditsUsed: 1 });
const quote = (cmcId: number, price: string, sourceUpdatedAt: number): Quote => ({ cmcId, price, sourceUpdatedAt });

/** Ответ CMC, которым управляет тест: запрос «висит», пока не вызван resolve (тот дожидается самого запроса) */
function deferredMarket() {
  let waiting: ((result: QuotesResult) => void) | null = null;
  const market = fakeMarket(
    (_ids, signal) =>
      new Promise((resolve, reject) => {
        waiting = resolve;
        signal?.addEventListener('abort', () => {
          waiting = null;
          reject(signal.reason as Error);
        });
      }),
  );
  const resolve = async (result: QuotesResult) => {
    while (waiting === null) await new Promise((next) => setImmediate(next));
    const answer = waiting;
    waiting = null;
    answer(result);
  };
  return { market, resolve };
}

function insertCoin(db: Database, id: number, symbol: string, cmcId: number, isPaused = false) {
  db.prepare(
    'INSERT INTO cryptocurrencies (id, cmc_id, symbol, name, is_paused, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(BigInt(id), BigInt(cmcId), symbol, `${symbol} coin`, isPaused ? 1n : 0n, BigInt(T0), BigInt(T0));
}

const rows = (db: Database, sql: string) => db.prepare(sql).all() as Record<string, unknown>[];

/** Двигает FakeClock, пока запуск не завершится: ретраи ждут через Clock.sleep, а HTTP к стабу — настоящий */
async function settle(clock: FakeClock, finished: Promise<SyncRunRecord>): Promise<SyncRunRecord> {
  let done = false;
  void finished.then(() => (done = true));
  while (!done) {
    await clock.advance(1000);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return finished;
}

describe(`[triggerSyncRun] POST ${RUNS}`, () => {
  it('✅ 202 + Location; запуск дошёл до succeeded: цены, свёртка, last_updated_at, события после записи', async () => {
    const { app, db, sync, published, clock } = await setupWithStub();
    insertCoin(db, 1, 'BTC', BTC);
    insertCoin(db, 2, 'ETH', ETH);

    const res = await request(app).post(RUNS).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('triggerSyncRun', 202);
    expect(res.headers.location).toBe(`${RUNS}/1`);
    expect(res.body).toMatchObject({ id: 1, trigger: 'manual', status: 'running', finishedAt: null, error: null });

    await sync.idle();
    const run = await request(app).get(`${RUNS}/1`).set(bearer(TOKENS.operator));
    expect(run).toMatchContract('getSyncRun', 200);
    expect(run.body).toEqual({
      id: 1,
      trigger: 'manual',
      status: 'succeeded',
      startedAt: iso(T0),
      finishedAt: iso(T0),
      coinsRequested: 2,
      pricesSaved: 2,
      attempts: 1,
      creditsUsed: 1,
      error: null,
    });

    const source = Date.parse('2026-10-07T11:59:00.000Z');
    expect(
      rows(
        db,
        'SELECT cryptocurrency_id, sync_run_id, price, source_updated_at, fetched_at FROM price_history ORDER BY 1',
      ),
    ).toEqual([
      { cryptocurrency_id: 1, sync_run_id: 1, price: '67123.451234567891', source_updated_at: source, fetched_at: T0 },
      { cryptocurrency_id: 2, sync_run_id: 1, price: '2456.78', source_updated_at: source, fetched_at: T0 },
    ]);
    expect(
      rows(
        db,
        'SELECT cryptocurrency_id, bucket_start, points, open, close, min, max FROM price_rollups_1h ORDER BY 1',
      ),
    ).toEqual([
      {
        cryptocurrency_id: 1,
        bucket_start: T0,
        points: 1,
        open: '67123.451234567891',
        close: '67123.451234567891',
        min: '67123.451234567891',
        max: '67123.451234567891',
      },
      {
        cryptocurrency_id: 2,
        bucket_start: T0,
        points: 1,
        open: '2456.78',
        close: '2456.78',
        min: '2456.78',
        max: '2456.78',
      },
    ]);
    expect(rows(db, 'SELECT last_updated_at FROM cryptocurrencies')).toEqual([
      { last_updated_at: T0 },
      { last_updated_at: T0 },
    ]);

    expect(published.map((event) => event.type)).toEqual(['price.updated', 'price.updated', 'sync.finished']);
    expect(published[0]).toMatchObject({
      version: 1,
      occurredAt: iso(clock.now()),
      payload: {
        cryptocurrencyId: 1,
        symbol: 'BTC',
        price: '67123.451234567891',
        currency: 'USD',
        sourceUpdatedAt: iso(source),
        fetchedAt: iso(T0),
        syncRunId: 1,
      },
    });
    expect(published[2]?.payload).toEqual(run.body);

    // Чтение цен видит результат синхронизации
    const prices = await request(app).get('/api/v1/prices').set(bearer(TOKENS.viewer));
    expect(prices).toMatchContract('listLatestPrices', 200);
    expect(prices.body.lastSync).toEqual({ id: 1, status: 'succeeded', finishedAt: iso(T0) });
    expect(prices.body.items[0].latest).toMatchObject({ price: '67123.451234567891', isStale: false });
  });

  it('❌ 409 sync-already-running + conflictingId, пока идёт запуск этого процесса (слой 1 — без записи в БД)', async () => {
    const cmc = deferredMarket();
    const { app, db, sync } = await createTestApp({ marketData: cmc.market });
    insertCoin(db, 1, 'BTC', BTC);

    const first = await request(app).post(RUNS).set(bearer(TOKENS.operator));
    expect(first).toMatchContract('triggerSyncRun', 202);
    const second = await request(app).post(RUNS).set(bearer(TOKENS.operator));
    expect(second).toMatchContract('triggerSyncRun', 409);
    expect(second.body).toMatchObject({ type: 'urn:cpt:problem:sync-already-running', conflictingId: 1 });
    expect(rows(db, 'SELECT id FROM sync_runs')).toHaveLength(1);

    await cmc.resolve(quotes(quote(BTC, '100', T0 - 1000)));
    await sync.idle();
    const third = await request(app).post(RUNS).set(bearer(TOKENS.operator));
    expect(third).toMatchContract('triggerSyncRun', 202);
    expect(third.body.id).toBe(2);
    await cmc.resolve(quotes());
    await sync.idle();
  });

  it('❌ 409: запуск идёт в другом процессе — срабатывает уникальный индекс БД (слой 2)', async () => {
    const { app, db, sync } = await createTestApp({ marketData: fakeMarket(() => Promise.resolve(quotes())) });
    db.prepare("INSERT INTO sync_runs (id, trigger, status, started_at) VALUES (7, 'schedule', 'running', ?)").run(
      BigInt(T0),
    );

    const res = await request(app).post(RUNS).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('triggerSyncRun', 409);
    expect(res.body.conflictingId).toBe(7);

    // Флаг процесса снят: когда чужой запуск закончится, наш пройдёт
    db.exec("UPDATE sync_runs SET status = 'succeeded', finished_at = started_at WHERE id = 7");
    expect(await request(app).post(RUNS).set(bearer(TOKENS.operator))).toMatchContract('triggerSyncRun', 202);
    await sync.idle();
  });

  it('❌ 500: запись запуска не создалась (БД недоступна) — флаг процесса снят, следующий запуск возможен', async () => {
    const base = await createTestApp();
    let broken = true;
    const uow: UnitOfWork = { run: (work) => (broken ? Promise.reject(new Error('db down')) : base.uow.run(work)) };
    const sync = new SyncService({
      uow,
      marketData: fakeMarket(() => Promise.resolve(quotes())),
      events: base.events,
      clock: base.clock,
      logger: base.logger,
    });
    await expect(sync.start('manual')).rejects.toThrow('db down');
    broken = false;
    await expect(sync.run('manual')).resolves.toMatchObject({ status: 'succeeded' });
  });
});

describe('SyncService: один запуск', () => {
  it('✅ три синхронизации за час → одна свёртка: open/close по времени, min/max по значению; новый час — новая свёртка', async () => {
    let next = quote(BTC, '100', T0 - 1000);
    const { db, sync, clock } = await createTestApp({ marketData: fakeMarket(() => Promise.resolve(quotes(next))) });
    insertCoin(db, 1, 'BTC', BTC);

    await sync.run('schedule');
    for (const price of ['9.5', '120.25']) {
      await clock.advance(5 * MINUTE);
      next = quote(BTC, price, clock.now() - 1000);
      await sync.run('schedule');
    }
    const rollups = 'SELECT bucket_start, points, open, close, min, max, sum_num FROM price_rollups_1h ORDER BY 1';
    // '9.5' > '120.25' как строки: минимум выбран по числу, а записан точной строкой
    expect(rows(db, rollups)).toEqual([
      { bucket_start: T0, points: 3, open: '100', close: '120.25', min: '9.5', max: '120.25', sum_num: 229.75 },
    ]);

    await clock.advance(HOUR);
    next = quote(BTC, '110', clock.now() - 1000);
    await sync.run('schedule');
    expect(rows(db, rollups)).toEqual([
      expect.objectContaining({ bucket_start: T0, points: 3 }),
      { bucket_start: T0 + HOUR, points: 1, open: '110', close: '110', min: '110', max: '110', sum_num: 110 },
    ]);
  });

  it('✅ CMC не обновил котировку (тот же source_updated_at) → дубля нет, pricesSaved = 0, price.updated не публикуется', async () => {
    const { db, sync, clock, published } = await createTestApp({
      marketData: fakeMarket(() => Promise.resolve(quotes(quote(BTC, '100', T0 - 1000)))),
    });
    insertCoin(db, 1, 'BTC', BTC);
    await sync.run('schedule');
    await clock.advance(5 * MINUTE);
    published.length = 0;

    const second = await sync.run('schedule');
    expect(second).toMatchObject({ status: 'succeeded', pricesSaved: 0 });
    expect(rows(db, 'SELECT id FROM price_history')).toHaveLength(1);
    expect(rows(db, 'SELECT last_updated_at FROM cryptocurrencies')).toEqual([{ last_updated_at: T0 }]);
    expect(published.map((event) => event.type)).toEqual(['sync.finished']);
  });

  it('✅ пустой watchlist → succeeded без вызова CMC: квота не тратится', async () => {
    const { sync } = await setupWithStub();
    const run = await sync.run('startup');
    expect(run).toMatchObject({
      trigger: 'startup',
      status: 'succeeded',
      coinsRequested: 0,
      attempts: 0,
      creditsUsed: null,
    });
    expect(stub.requests).toEqual([]);
  });

  it('✅ монета на паузе не запрашивается', async () => {
    const { db, sync } = await setupWithStub();
    insertCoin(db, 1, 'BTC', BTC);
    insertCoin(db, 2, 'ETH', ETH, true);
    expect(await sync.run('schedule')).toMatchObject({ coinsRequested: 1, pricesSaved: 1 });
    expect(stub.requests[0]?.query.id).toBe(String(BTC));
  });

  it('✅ partial: нет котировки (делистинг) и битая цена — остальное сохранено, id — в сообщении', async () => {
    const { app, db, sync } = await setupWithStub();
    insertCoin(db, 1, 'BTC', BTC);
    insertCoin(db, 2, 'GONE', 555);
    insertCoin(db, 3, 'NOPRICE', 99003);

    await sync.run('schedule');
    const res = await request(app).get(`${RUNS}/1`).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('getSyncRun', 200);
    expect(res.body).toMatchObject({ status: 'partial', coinsRequested: 3, pricesSaved: 1 });
    expect(res.body.error.code).toBe(PARTIAL_CODE);
    expect(res.body.error.message).toMatch(/no quote for cmcId: 555; invalid quote for cmcId: 99003 \(.+\)/);
    expect(rows(db, 'SELECT cryptocurrency_id FROM price_history')).toEqual([{ cryptocurrency_id: 1 }]);
  });

  it('✅ временный сбой CMC → ретрай с ожиданием через Clock, запуск успешен со второй попытки', async () => {
    const { db, sync, clock, logs } = await setupWithStub();
    insertCoin(db, 1, 'BTC', BTC);
    stub.fail({ kind: 'status', status: 503 });

    const { finished } = await sync.start('schedule');
    expect(await settle(clock, finished)).toMatchObject({ status: 'succeeded', attempts: 2, pricesSaved: 1 });
    expect(logs().find((entry) => entry.msg === 'sync retry')).toMatchObject({ attempt: 1, code: 'CMC_UNAVAILABLE' });
  });

  it('❌ CMC лежит → failed с error_code после 3 попыток; старые цены на месте (F7), sync.finished(failed)', async () => {
    const { app, db, sync, clock, published } = await setupWithStub();
    insertCoin(db, 1, 'BTC', BTC);
    await sync.run('schedule');
    published.length = 0;
    await clock.advance(5 * MINUTE);
    stub.fail({ kind: 'status', status: 500 }, { kind: 'drop' }, { kind: 'status', status: 502 });

    const { finished } = await sync.start('schedule');
    await settle(clock, finished);

    const res = await request(app).get(`${RUNS}/2`).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('getSyncRun', 200);
    expect(res.body).toMatchObject({
      status: 'failed',
      coinsRequested: 1,
      pricesSaved: 0,
      attempts: 3,
      creditsUsed: null,
      error: { code: 'CMC_UNAVAILABLE' },
    });
    expect(published.map((event) => event.type)).toEqual(['sync.finished']);
    expect(published[0]?.payload).toMatchObject({ status: 'failed' });

    const prices = await request(app).get('/api/v1/prices').set(bearer(TOKENS.viewer));
    expect(prices.body.items[0].latest.price).toBe('67123.451234567891');
    expect(prices.body.lastSync).toMatchObject({ id: 2, status: 'failed' });
  });

  it('❌ неверный ключ CMC не ретраится: failed CMC_AUTH с первой попытки', async () => {
    const { db, sync, clock } = await setupWithStub();
    insertCoin(db, 1, 'BTC', BTC);
    stub.fail({ kind: 'status', status: 401 });
    const run = await sync.run('schedule');
    expect(run).toMatchObject({ status: 'failed', attempts: 1, errorCode: 'CMC_AUTH' });
    expect(clock.pendingSleeps).toBe(0);
  });

  it('❌ неожиданная ошибка → failed SYNC_INTERNAL без деталей наружу, подробности — в логе', async () => {
    const { db, sync, logs } = await createTestApp({
      marketData: fakeMarket(() => Promise.reject(new TypeError('secret internals'))),
    });
    insertCoin(db, 1, 'BTC', BTC);
    const run = await sync.run('schedule');
    expect(run).toMatchObject({ status: 'failed', errorCode: INTERNAL_CODE });
    expect(run.errorMessage).not.toContain('secret');
    expect(logs().some((entry) => entry.msg === 'sync crashed' && entry.level === 'error')).toBe(true);
  });

  it('✅ монету удалили, пока шёл запрос к CMC → её цена пропущена, остальные сохранены', async () => {
    const cmc = deferredMarket();
    const { db, sync } = await createTestApp({ marketData: cmc.market });
    insertCoin(db, 1, 'BTC', BTC);
    insertCoin(db, 2, 'ETH', ETH);

    const { finished } = await sync.start('schedule');
    db.exec('DELETE FROM cryptocurrencies WHERE id = 2');
    await cmc.resolve(quotes(quote(BTC, '100', T0 - 1000), quote(ETH, '5', T0 - 1000), quote(424242, '1', T0 - 1000)));

    expect(await finished).toMatchObject({ status: 'succeeded', coinsRequested: 2, pricesSaved: 1 });
    expect(rows(db, 'SELECT cryptocurrency_id FROM price_history')).toEqual([{ cryptocurrency_id: 1 }]);
  });

  it('✅ abort (остановка процесса) → запрос к CMC отменён, запуск interrupted, следующий возможен', async () => {
    const cmc = deferredMarket();
    const { db, sync, published } = await createTestApp({ marketData: cmc.market });
    insertCoin(db, 1, 'BTC', BTC);

    const { finished } = await sync.start('schedule');
    await new Promise((resolve) => setImmediate(resolve));
    sync.abort(new Error('shutdown'));
    expect(await finished).toMatchObject({ status: 'interrupted', finishedAt: T0, pricesSaved: 0 });
    expect(published.map((event) => event.type)).toEqual(['sync.finished']);

    sync.abort(new Error('no-op: запуска нет'));
    const next = await sync.start('manual');
    await cmc.resolve(quotes());
    expect(await next.finished).toMatchObject({ id: 2, status: 'succeeded' });
  });

  it('❌ БД отказала посреди запуска → итог не сохранён, но finished не отклоняется: запись станет interrupted при старте', async () => {
    const base = await createTestApp();
    let broken = false;
    const uow: UnitOfWork = { run: (work) => (broken ? Promise.reject(new Error('db down')) : base.uow.run(work)) };
    const sync = new SyncService({
      uow,
      marketData: unconfiguredMarketData,
      events: base.events,
      clock: base.clock,
      logger: base.logger,
    });

    const { run, finished } = await sync.start('schedule');
    broken = true;
    expect(await finished).toEqual(run);
    expect(base.logs().map((entry) => entry.msg)).toEqual(
      expect.arrayContaining(['sync crashed', 'sync result was not saved']),
    );
  });
});

describe(`[listSyncRuns] GET ${RUNS}`, () => {
  it('✅ 200: от новых к старым, курсорная пагинация', async () => {
    const { app, db } = await createTestApp();
    const insert = db.prepare(
      "INSERT INTO sync_runs (trigger, status, started_at, finished_at, error_code, error_message) VALUES ('schedule', ?, ?, ?, ?, ?)",
    );
    insert.run('succeeded', BigInt(T0), BigInt(T0 + 1), null, null);
    insert.run('failed', BigInt(T0 + 10), BigInt(T0 + 11), 'CMC_TIMEOUT', 'timeout');
    insert.run('running', BigInt(T0 + 20), null, null, null);

    const first = await request(app).get(RUNS).query({ limit: 2 }).set(bearer(TOKENS.operator));
    expect(first).toMatchContract('listSyncRuns', 200);
    expect(first.body.items.map((run: { id: number }) => run.id)).toEqual([3, 2]);
    expect(first.body.items[1].error).toEqual({ code: 'CMC_TIMEOUT', message: 'timeout' });
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app)
      .get(RUNS)
      .query({ limit: 2, cursor: first.body.nextCursor })
      .set(bearer(TOKENS.operator));
    expect(second).toMatchContract('listSyncRuns', 200);
    expect(second.body).toMatchObject({ items: [{ id: 1 }], nextCursor: null });
  });

  it('❌ 400: битый cursor', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get(RUNS).query({ cursor: 'not-a-cursor' }).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('listSyncRuns', 400);
    expect(res.body.errors[0].path).toBe('/query/cursor');
  });

  it('❌ 403: ключ только с prices:read', async () => {
    const { app } = await createTestApp();
    expect(await request(app).get(RUNS).set(bearer(TOKENS.viewer))).toMatchContract('listSyncRuns', 403);
  });
});

describe(`[getSyncRun] GET ${RUNS}/{id}`, () => {
  it('✅ 200: завершённый запуск по id — статус, счётчики и время', async () => {
    const { app, db, sync } = await setupWithStub();
    insertCoin(db, 1, 'BTC', BTC);
    await sync.run('schedule');

    const res = await request(app).get(`${RUNS}/1`).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('getSyncRun', 200);
    expect(res.body).toMatchObject({
      id: 1,
      trigger: 'schedule',
      status: 'succeeded',
      startedAt: iso(T0),
      finishedAt: iso(T0),
      coinsRequested: 1,
      pricesSaved: 1,
      error: null,
    });
  });

  it('❌ 404: запуска нет · 400: id не число', async () => {
    const { app } = await createTestApp();
    expect(await request(app).get(`${RUNS}/99`).set(bearer(TOKENS.operator))).toMatchContract('getSyncRun', 404);
    expect(await request(app).get(`${RUNS}/abc`).set(bearer(TOKENS.operator))).toMatchContract('getSyncRun', 400);
  });
});

describe('[getCmcStatus] GET /api/v1/system/cmc', () => {
  const URL = '/api/v1/system/cmc';

  it('✅ 200: до первого обращения к CMC — всё null; запуск с пустым watchlist успехом CMC не считается', async () => {
    const { app, sync } = await setupWithStub();
    await sync.run('startup');
    const res = await request(app).get(URL).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('getCmcStatus', 200);
    expect(res.body).toEqual({ lastSuccessAt: null, lastError: null, quota: null });
  });

  it('✅ 200: кредиты из стаба, последний успех и последняя ошибка', async () => {
    const { app, db, sync, clock } = await setupWithStub();
    insertCoin(db, 1, 'BTC', BTC);
    await sync.run('schedule');
    await clock.advance(5 * MINUTE);
    stub.fail({ kind: 'status', status: 403 });
    await sync.run('schedule');

    const res = await request(app).get(URL).set(bearer(TOKENS.operator));
    expect(res).toMatchContract('getCmcStatus', 200);
    expect(res.body).toEqual({
      lastSuccessAt: iso(T0),
      lastError: { code: 'CMC_AUTH', message: expect.any(String), at: iso(T0 + 5 * MINUTE) },
      quota: { ...USAGE, fetchedAt: iso(T0) },
    });
  });

  it('✅ сбой key/info не портит запуск: quota остаётся null, предупреждение в логе', async () => {
    const market = fakeMarket(() => Promise.resolve(quotes(quote(BTC, '100', T0 - 1000))));
    market.getUsage = () => Promise.reject(new Error('key/info is down'));
    const { app, db, sync, logs } = await createTestApp({ marketData: market });
    insertCoin(db, 1, 'BTC', BTC);
    expect(await sync.run('schedule')).toMatchObject({ status: 'succeeded' });

    const res = await request(app).get(URL).set(bearer(TOKENS.operator));
    expect(res.body).toMatchObject({ lastSuccessAt: iso(T0), quota: null });
    expect(logs().some((entry) => entry.msg === 'cmc usage refresh failed' && entry.level === 'warn')).toBe(true);
  });

  it('❌ 403: ключ только с prices:read', async () => {
    const { app } = await createTestApp();
    expect(await request(app).get(URL).set(bearer(TOKENS.viewer))).toMatchContract('getCmcStatus', 403);
  });
});
