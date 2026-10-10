// Чтение цен (F3–F5) целиком: HTTP → роутер из спеки → PriceQueryService → SQLite :memory:.
// Кейсы — по таблице C8 в ROADMAP; каждый ответ сверяется с контрактом. Свёртки вставляются напрямую:
// их пишет синхронизация (B12), а здесь проверяется только чтение.
import request from 'supertest';
import type { Database } from '../../src/db/database.ts';
import { bearer, TOKENS } from '../helpers/auth.ts';
import { createTestApp } from '../helpers/app.ts';
import { T0 } from '../helpers/db.ts';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (text: string) => Date.parse(text);
const iso = (ms: number) => new Date(ms).toISOString();

function insertCoin(db: Database, id: number, symbol: string) {
  db.prepare(
    'INSERT INTO cryptocurrencies (id, cmc_id, symbol, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(BigInt(id), BigInt(id), symbol, `${symbol} coin`, BigInt(T0), BigInt(T0));
}

function insertPrice(
  db: Database,
  coinId: number,
  price: string,
  fetchedAt: number,
  sourceUpdatedAt = fetchedAt - 1000,
) {
  db.prepare(
    'INSERT INTO price_history (cryptocurrency_id, price, source_updated_at, fetched_at) VALUES (?, ?, ?, ?)',
  ).run(BigInt(coinId), price, BigInt(sourceUpdatedAt), BigInt(fetchedAt));
}

type Rollup = { open: string; close: string; min: string; max: string; points: number; sum: number };

function insertRollup(db: Database, coinId: number, bucketStart: number, rollup: Rollup) {
  db.prepare(
    `INSERT INTO price_rollups_1h (cryptocurrency_id, bucket_start, points, open, close, min, max, sum_num)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    BigInt(coinId),
    BigInt(bucketStart),
    BigInt(rollup.points),
    rollup.open,
    rollup.close,
    rollup.min,
    rollup.max,
    rollup.sum,
  );
}

/** Свёртка часа с одной ценой — когда важны только время и close */
const flat = (price: string): Rollup => ({
  open: price,
  close: price,
  min: price,
  max: price,
  points: 1,
  sum: Number(price),
});

describe('[listLatestPrices] GET /api/v1/prices', () => {
  const URL = '/api/v1/prices';

  it('✅ 200: точная строка цены, change24h, isStale, latest = null без цен, lastSync = null до первого запуска', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    insertCoin(db, 2, 'ETH');
    insertCoin(db, 3, 'DOGE');
    insertPrice(db, 1, '60000', T0 - 25 * HOUR);
    insertPrice(db, 1, '67123.451234567891', T0 - MINUTE);
    // Истории меньше суток и пропущено больше двух синхронизаций (интервал в тестах — 5 мин)
    insertPrice(db, 2, '2500.5', T0 - 11 * MINUTE);

    const res = await request(app).get(URL).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listLatestPrices', 200);
    expect(res.body).toEqual({
      currency: 'USD',
      lastSync: null,
      items: [
        {
          cryptocurrencyId: 1,
          symbol: 'BTC',
          name: 'BTC coin',
          latest: {
            price: '67123.451234567891',
            currency: 'USD',
            sourceUpdatedAt: iso(T0 - MINUTE - 1000),
            fetchedAt: iso(T0 - MINUTE),
            change24hPercent: '11.8724',
            isStale: false,
          },
        },
        { cryptocurrencyId: 3, symbol: 'DOGE', name: 'DOGE coin', latest: null },
        {
          cryptocurrencyId: 2,
          symbol: 'ETH',
          name: 'ETH coin',
          latest: expect.objectContaining({ price: '2500.5', change24hPercent: null, isStale: true }),
        },
      ],
    });
  });

  it('✅ 200: lastSync — самый свежий запуск, в том числе ещё идущий', async () => {
    const { app, db } = await createTestApp();
    const insert = db.prepare('INSERT INTO sync_runs (trigger, status, started_at, finished_at) VALUES (?, ?, ?, ?)');
    insert.run('schedule', 'partial', BigInt(T0 - 10 * MINUTE), BigInt(T0 - 9 * MINUTE));

    const finished = await request(app).get(URL).set(bearer(TOKENS.viewer));
    expect(finished).toMatchContract('listLatestPrices', 200);
    expect(finished.body).toEqual({
      currency: 'USD',
      lastSync: { id: 1, status: 'partial', finishedAt: iso(T0 - 9 * MINUTE) },
      items: [],
    });

    insert.run('manual', 'running', BigInt(T0 - MINUTE), null);
    const running = await request(app).get(URL).set(bearer(TOKENS.viewer));
    expect(running).toMatchContract('listLatestPrices', 200);
    expect(running.body.lastSync).toEqual({ id: 2, status: 'running', finishedAt: null });
  });

  it('❌ 401: ключ отозван', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get(URL).set(bearer(TOKENS.revoked));
    expect(res).toMatchContract('listLatestPrices', 401);
  });
});

describe('[listSparklines] GET /api/v1/prices/sparklines', () => {
  const URL = '/api/v1/prices/sparklines';

  it('✅ 200: 24h по умолчанию — часовые точки окна, пустой points у монеты без данных', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    insertCoin(db, 2, 'ETH');
    insertRollup(db, 1, T0 - 24 * HOUR, flat('1')); // за окном: окно — 24 бакета, включая текущий
    insertRollup(db, 1, T0 - 23 * HOUR, flat('2'));
    insertRollup(db, 1, T0 - HOUR, { ...flat('3'), close: '3.5' });
    insertRollup(db, 1, T0, flat('4'));

    const res = await request(app).get(URL).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listSparklines', 200);
    expect(res.body).toEqual({
      currency: 'USD',
      window: '24h',
      interval: '1h',
      items: [
        {
          cryptocurrencyId: 1,
          points: [
            { bucketStart: iso(T0 - 23 * HOUR), close: '2' },
            { bucketStart: iso(T0 - HOUR), close: '3.5' },
            { bucketStart: iso(T0), close: '4' },
          ],
        },
        { cryptocurrencyId: 2, points: [] },
      ],
    });
  });

  it('✅ 200: 7d — бакеты по 4 ч, close бакета — close его последнего часа', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    insertCoin(db, 2, 'ETH');
    insertRollup(db, 1, at('2026-09-30T15:00:00Z'), flat('1')); // за окном: 42 бакета от 30.09 16:00
    insertRollup(db, 1, at('2026-09-30T16:00:00Z'), flat('2'));
    insertRollup(db, 1, at('2026-10-07T08:00:00Z'), flat('9'));
    insertRollup(db, 1, at('2026-10-07T11:00:00Z'), flat('10'));
    insertRollup(db, 1, at('2026-10-07T12:00:00Z'), flat('11'));
    insertRollup(db, 2, at('2026-10-07T09:00:00Z'), flat('5'));

    const res = await request(app).get(URL).query({ window: '7d' }).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listSparklines', 200);
    expect(res.body).toEqual({
      currency: 'USD',
      window: '7d',
      interval: '4h',
      items: [
        {
          cryptocurrencyId: 1,
          points: [
            { bucketStart: '2026-09-30T16:00:00.000Z', close: '2' },
            { bucketStart: '2026-10-07T08:00:00.000Z', close: '10' },
            { bucketStart: '2026-10-07T12:00:00.000Z', close: '11' },
          ],
        },
        { cryptocurrencyId: 2, points: [{ bucketStart: '2026-10-07T08:00:00.000Z', close: '5' }] },
      ],
    });
  });

  it('❌ 400: window=1y', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get(URL).query({ window: '1y' }).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listSparklines', 400);
    expect(res.body.errors[0].path).toBe('/query/window');
  });
});

describe('[listPriceHistory] GET /api/v1/cryptocurrencies/{id}/prices', () => {
  const URL = '/api/v1/cryptocurrencies/1/prices';

  it('✅ 200: страницы от новых к старым без дублей и пропусков, даже если между запросами пришла новая цена', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    insertCoin(db, 2, 'ETH');
    insertPrice(db, 1, '101', T0 - 50 * MINUTE);
    insertPrice(db, 1, '102', T0 - 40 * MINUTE);
    // Две точки с одним fetched_at: порядок между ними задаёт id — вторая половина ключа курсора
    insertPrice(db, 1, '103', T0 - 30 * MINUTE, T0 - 31 * MINUTE);
    insertPrice(db, 1, '104', T0 - 30 * MINUTE, T0 - 30 * MINUTE);
    insertPrice(db, 1, '105', T0 - 20 * MINUTE);
    insertPrice(db, 2, '999', T0 - 25 * MINUTE); // чужая монета в ответ не попадает

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 1; page <= 3; page += 1) {
      const res = await request(app)
        .get(URL)
        .query({ limit: 2, ...(cursor && { cursor }) })
        .set(bearer(TOKENS.viewer));
      expect(res).toMatchContract('listPriceHistory', 200);
      seen.push(...res.body.items.map((item: { price: string }) => item.price));
      cursor = res.body.nextCursor ?? undefined;
      // Новая цена между запросами: с OFFSET она сдвинула бы страницы и дала дубль
      if (page === 1) insertPrice(db, 1, '106', T0 - 10 * MINUTE);
    }
    expect(seen).toEqual(['105', '104', '103', '102', '101']);
    expect(cursor).toBeUndefined();
  });

  it('✅ 200: период [from, to) — from включительно, to нет; формат точки', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    insertPrice(db, 1, '1', T0 - 3 * HOUR - 1);
    insertPrice(db, 1, '2', T0 - 3 * HOUR);
    insertPrice(db, 1, '3', T0 - 2 * HOUR);
    insertPrice(db, 1, '4', T0 - HOUR);

    const res = await request(app)
      .get(URL)
      .query({ from: iso(T0 - 3 * HOUR), to: iso(T0 - HOUR) })
      .set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listPriceHistory', 200);
    expect(res.body).toEqual({
      cryptocurrencyId: 1,
      currency: 'USD',
      items: [
        { price: '3', sourceUpdatedAt: iso(T0 - 2 * HOUR - 1000), fetchedAt: iso(T0 - 2 * HOUR) },
        { price: '2', sourceUpdatedAt: iso(T0 - 3 * HOUR - 1000), fetchedAt: iso(T0 - 3 * HOUR) },
      ],
      nextCursor: null,
    });
  });

  it.each([
    ['from без зоны', { from: '2026-10-06T12:00:00' }, '/query/from'],
    ['битый cursor', { cursor: 'not-a-cursor' }, '/query/cursor'],
    ['limit=0', { limit: 0 }, '/query/limit'],
    ['limit=1001', { limit: 1001 }, '/query/limit'],
    ['from не раньше to', { from: iso(T0), to: iso(T0) }, '/query/from'],
  ])('❌ 400: %s', async (_name, query, path) => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    const res = await request(app).get(URL).query(query).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listPriceHistory', 400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual([path]);
  });

  it('❌ 404: монета не отслеживается', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get(URL).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listPriceHistory', 404);
  });
});

describe('[getPriceAggregates] GET /api/v1/cryptocurrencies/{id}/prices/aggregates', () => {
  const URL = '/api/v1/cryptocurrencies/1/prices/aggregates';

  it('✅ 200: 1h — свёртки как есть, avg до 10 значащих цифр, сводка за период, to по умолчанию — сейчас', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    insertCoin(db, 2, 'ETH');
    insertRollup(db, 1, T0 - 3 * HOUR, flat('1')); // раньше from
    insertRollup(db, 1, T0 - 2 * HOUR, { open: '100', close: '110', min: '100', max: '110', points: 2, sum: 210 });
    insertRollup(db, 1, T0 - HOUR, {
      open: '110',
      close: '99.5',
      min: '99.5',
      max: '120.123456789012',
      points: 3,
      sum: 329.623456789012,
    });
    insertRollup(db, 2, T0 - HOUR, flat('7'));

    const res = await request(app)
      .get(URL)
      .query({ interval: '1h', from: iso(T0 - 2 * HOUR) })
      .set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getPriceAggregates', 200);
    expect(res.body).toEqual({
      cryptocurrencyId: 1,
      currency: 'USD',
      interval: '1h',
      from: iso(T0 - 2 * HOUR),
      to: iso(T0),
      summary: {
        open: '100',
        close: '99.5',
        min: '99.5',
        max: '120.123456789012',
        avg: '107.9246914',
        changePercent: '-0.5',
        points: 5,
      },
      buckets: [
        {
          bucketStart: iso(T0 - 2 * HOUR),
          stats: { open: '100', close: '110', min: '100', max: '110', avg: '105', changePercent: '10', points: 2 },
        },
        {
          bucketStart: iso(T0 - HOUR),
          stats: {
            open: '110',
            close: '99.5',
            min: '99.5',
            max: '120.123456789012',
            avg: '109.8744856',
            changePercent: '-9.5455',
            points: 3,
          },
        },
      ],
    });
  });

  it('✅ 200: 1d — часы собраны в сутки; min/max — точные наблюдённые цены, а не лексикографические', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    // '10.25' < '9.5' как строки: MIN/MAX по TEXT перепутали бы экстремумы
    insertRollup(db, 1, at('2026-10-05T10:00:00Z'), {
      open: '9.5',
      close: '9.8',
      min: '9.5',
      max: '9.9',
      points: 2,
      sum: 19.3,
    });
    insertRollup(db, 1, at('2026-10-05T20:00:00Z'), {
      open: '9.8',
      close: '10.25',
      min: '9.7',
      max: '10.25',
      points: 2,
      sum: 19.95,
    });
    insertRollup(db, 1, at('2026-10-06T01:00:00Z'), {
      open: '10.25',
      close: '10',
      min: '10',
      max: '10.25',
      points: 2,
      sum: 20.25,
    });

    const res = await request(app)
      .get(URL)
      .query({ interval: '1d', from: '2026-10-05T03:00:00+03:00', to: '2026-10-07T00:00:00Z' })
      .set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getPriceAggregates', 200);
    expect(res.body.from).toBe('2026-10-05T00:00:00.000Z');
    expect(res.body.summary).toEqual({
      open: '9.5',
      close: '10',
      min: '9.5',
      max: '10.25',
      avg: '9.916666667',
      changePercent: '5.2632',
      points: 6,
    });
    expect(res.body.buckets).toEqual([
      {
        bucketStart: '2026-10-05T00:00:00.000Z',
        stats: {
          open: '9.5',
          close: '10.25',
          min: '9.5',
          max: '10.25',
          avg: '9.8125',
          changePercent: '7.8947',
          points: 4,
        },
      },
      {
        bucketStart: '2026-10-06T00:00:00.000Z',
        stats: {
          open: '10.25',
          close: '10',
          min: '10',
          max: '10.25',
          avg: '10.125',
          changePercent: '-2.439',
          points: 2,
        },
      },
    ]);
  });

  it('✅ 200: 1w — неделя начинается с понедельника; 4h — бакеты по 4 часа', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    insertRollup(db, 1, at('2026-10-04T23:00:00Z'), flat('1')); // воскресенье
    insertRollup(db, 1, at('2026-10-05T00:00:00Z'), flat('2')); // понедельник
    insertRollup(db, 1, at('2026-10-05T03:00:00Z'), flat('3'));
    insertRollup(db, 1, at('2026-10-05T04:00:00Z'), flat('4'));

    const weeks = await request(app)
      .get(URL)
      .query({ interval: '1w', from: '2026-09-28T00:00:00Z' })
      .set(bearer(TOKENS.viewer));
    expect(weeks).toMatchContract('getPriceAggregates', 200);
    expect(
      weeks.body.buckets.map((b: { bucketStart: string; stats: { points: number } }) => [
        b.bucketStart,
        b.stats.points,
      ]),
    ).toEqual([
      ['2026-09-28T00:00:00.000Z', 1],
      ['2026-10-05T00:00:00.000Z', 3],
    ]);

    const fourHours = await request(app)
      .get(URL)
      .query({ interval: '4h', from: '2026-10-04T00:00:00Z' })
      .set(bearer(TOKENS.viewer));
    expect(fourHours).toMatchContract('getPriceAggregates', 200);
    expect(
      fourHours.body.buckets.map((b: { bucketStart: string; stats: { close: string } }) => [
        b.bucketStart,
        b.stats.close,
      ]),
    ).toEqual([
      ['2026-10-04T20:00:00.000Z', '1'],
      ['2026-10-05T00:00:00.000Z', '3'],
      ['2026-10-05T04:00:00.000Z', '4'],
    ]);
  });

  it('✅ 200: данных за период нет — summary = null, пустые бакеты не выдумываются', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    const res = await request(app)
      .get(URL)
      .query({ interval: '1d', from: iso(T0 - 24 * HOUR) })
      .set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getPriceAggregates', 200);
    expect(res.body).toMatchObject({ summary: null, buckets: [] });
  });

  it.each([
    ['больше 1000 бакетов', { interval: '1h', from: iso(T0 - 1001 * HOUR) }, '/query/from'],
    ['нет interval', { from: iso(T0 - HOUR) }, '/query/interval'],
    ['from в будущем (to по умолчанию — сейчас)', { interval: '1h', from: iso(T0 + HOUR) }, '/query/from'],
  ])('❌ 400: %s', async (_name, query, path) => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    const res = await request(app).get(URL).query(query).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getPriceAggregates', 400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual([path]);
  });

  it('✅ 200: ровно 1000 бакетов — ещё можно', async () => {
    const { app, db } = await createTestApp();
    insertCoin(db, 1, 'BTC');
    const res = await request(app)
      .get(URL)
      .query({ interval: '1h', from: iso(T0 - 1000 * HOUR) })
      .set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getPriceAggregates', 200);
  });

  it('❌ 404: монета не отслеживается', async () => {
    const { app } = await createTestApp();
    const res = await request(app)
      .get(URL)
      .query({ interval: '1h', from: iso(T0 - HOUR) })
      .set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getPriceAggregates', 404);
  });
});
