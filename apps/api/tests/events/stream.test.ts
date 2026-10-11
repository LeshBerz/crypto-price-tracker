// Поток событий (C8): настоящее HTTP-соединение к приложению, события — от настоящих сервисов,
// время — FakeClock. Отдельно — хаб на обычном Writable: медленный клиент и остановка.
import { Writable } from 'node:stream';
import request from 'supertest';
import { InProcessEventBus, createEvent } from '../../src/events/event-bus.ts';
import { HEARTBEAT_MS, MAX_BUFFERED_BYTES, SseHub, formatSse } from '../../src/events/sse-hub.ts';
import type { MarketDataProvider } from '../../src/market-data/provider.ts';
import { bearer, TOKENS } from '../helpers/auth.ts';
import { createTestApp, unconfiguredMarketData } from '../helpers/app.ts';
import { T0 } from '../helpers/db.ts';
import { FakeClock } from '../helpers/fake-clock.ts';
import { createSpyLogger } from '../helpers/logger.ts';
import { openStream, parseFrames, type SseClient } from '../helpers/sse.ts';

const STREAM = '/api/v1/stream';
const UUID = /^[0-9a-f-]{36}$/;
const SOURCE = Date.parse('2026-10-07T11:59:00.000Z');

let client: SseClient | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

const market: MarketDataProvider = {
  ...unconfiguredMarketData,
  getQuotes: () =>
    Promise.resolve({
      quotes: [{ cmcId: 1, price: '67123.45', sourceUpdatedAt: SOURCE }],
      missing: [],
      rejected: [],
      creditsUsed: 1,
    }),
};

describe(`[streamEvents] GET ${STREAM}`, () => {
  it('✅ 200 text/event-stream: price.updated и sync.finished после синхронизации, с полем id', async () => {
    const { app, db, sync, published } = await createTestApp({ marketData: market });
    db.prepare(
      'INSERT INTO cryptocurrencies (id, cmc_id, symbol, name, is_paused, created_at, updated_at) VALUES (1, 1, ?, ?, 0, ?, ?)',
    ).run('BTC', 'Bitcoin', BigInt(T0), BigInt(T0));

    client = await openStream(app, bearer(TOKENS.viewer));
    expect(client.response()).toMatchContract('streamEvents', 200);
    expect(client.response().headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(client.response().headers['cache-control']).toBe('no-cache, no-transform');

    const run = await sync.run('manual');
    expect(run.status).toBe('succeeded');

    const price = await client.waitFor('price.updated');
    const iso = new Date(T0).toISOString();
    // Ровно поля контракта: syncRunId остаётся внутри шины
    expect(price.data).toEqual({
      cryptocurrencyId: 1,
      symbol: 'BTC',
      price: '67123.45',
      currency: 'USD',
      sourceUpdatedAt: new Date(SOURCE).toISOString(),
      fetchedAt: iso,
    });
    expect(price.id).toBe(published.find((event) => event.type === 'price.updated')?.id);

    const finished = await client.waitFor('sync.finished');
    expect(finished.data).toMatchObject({ id: 1, status: 'succeeded', pricesSaved: 1 });
    expect(client.frames().map((frame) => frame.event)).toEqual(['price.updated', 'sync.finished']);
  });

  it('✅ watchlist.changed доходит до всех подключённых клиентов', async () => {
    const { app, events, clock, sse } = await createTestApp();
    client = await openStream(app, bearer(TOKENS.viewer));
    const second = await openStream(app, bearer(TOKENS.operator));
    try {
      expect(sse.size).toBe(2);
      events.publish(createEvent('watchlist.changed', { cryptocurrencyId: 7, change: 'added' }, clock));
      for (const stream of [client, second]) {
        expect((await stream.waitFor('watchlist.changed')).data).toEqual({ cryptocurrencyId: 7, change: 'added' });
      }
    } finally {
      await second.close();
    }
  });

  it('✅ heartbeat каждые 25 с по FakeClock', async () => {
    const { app, clock } = await createTestApp();
    client = await openStream(app, bearer(TOKENS.viewer));

    await clock.advance(HEARTBEAT_MS - 1);
    expect(client.frames()).toEqual([]);
    await clock.advance(1);
    const beat = await client.waitFor('heartbeat');
    expect(beat.data).toEqual({});
    expect(beat.id).toMatch(UUID);

    await clock.advance(HEARTBEAT_MS);
    while (client.frames().length < 2) await new Promise((next) => setImmediate(next));
    expect(client.frames().map((frame) => frame.event)).toEqual(['heartbeat', 'heartbeat']);
  });

  it('✅ клиент отключился — хаб забывает соединение и останавливает heartbeat', async () => {
    const { app, clock, sse } = await createTestApp();
    client = await openStream(app, bearer(TOKENS.viewer));
    expect(clock.pendingSleeps).toBe(1);

    await client.close();
    client = undefined;
    while (sse.size > 0) await new Promise((next) => setImmediate(next));
    expect(clock.pendingSleeps).toBe(0);
  });

  it('✅ closeAll: клиент получает shutdown, поток закрывается; новый клиент — сразу shutdown', async () => {
    const { app, events, clock, sse } = await createTestApp();
    client = await openStream(app, bearer(TOKENS.viewer));

    sse.closeAll();
    await client.ended;
    expect(client.frames().map((frame) => frame.event)).toEqual(['shutdown']);
    expect(sse.size).toBe(0);
    expect(clock.pendingSleeps).toBe(0);

    // Повторный вызов и события после остановки ничего не ломают
    sse.closeAll();
    events.publish(createEvent('watchlist.changed', { cryptocurrencyId: 1, change: 'removed' }, clock));

    const late = await openStream(app, bearer(TOKENS.viewer));
    try {
      await late.ended;
      expect(late.response()).toMatchContract('streamEvents', 200);
      expect(late.frames().map((frame) => frame.event)).toEqual(['shutdown']);
    } finally {
      await late.close();
    }
  });

  it('❌ 401 без ключа', async () => {
    const { app, sse } = await createTestApp();
    const res = await request(app).get(STREAM);
    expect(res).toMatchContract('streamEvents', 401);
    expect(sse.size).toBe(0);
  });

  it('❌ 403 без scope prices:read', async () => {
    const { app } = await createTestApp();
    expect(await request(app).get(STREAM).set(bearer(TOKENS.opsWriteOnly))).toMatchContract('streamEvents', 403);
  });

  it('❌ 400 на неизвестный query-параметр', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get(`${STREAM}?since=1`).set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('streamEvents', 400);
  });
});

describe('SseHub на Writable', () => {
  function setup() {
    const clock = new FakeClock();
    const { logger, entries } = createSpyLogger(clock);
    const events = new InProcessEventBus(logger);
    return { clock, events, logs: entries, hub: new SseHub({ events, clock, logger }) };
  }

  /** Поток-«клиент», который ничего не читает: записи копятся в его буфере */
  const stalled = () => new Writable({ highWaterMark: 16, write: () => undefined });

  it('formatSse: id, event и data одной строкой', () => {
    const frame = formatSse('heartbeat', { a: 'line\nbreak' }, 'abc');
    expect(frame).toBe('id: abc\nevent: heartbeat\ndata: {"a":"line\\nbreak"}\n\n');
    expect(parseFrames(frame)).toEqual([{ id: 'abc', event: 'heartbeat', data: { a: 'line\nbreak' } }]);
  });

  it('клиент, который не читает поток, отключается после порога буфера, остальные продолжают получать', async () => {
    const { hub, events, clock, logs } = setup();
    const slow = stalled();
    const received: string[] = [];
    const healthy = new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        received.push(chunk.toString());
        done();
      },
    });
    hub.add(slow);
    hub.add(healthy);

    slow.write('x'.repeat(MAX_BUFFERED_BYTES + 1));
    events.publish(createEvent('watchlist.changed', { cryptocurrencyId: 1, change: 'updated' }, clock));

    expect(slow.destroyed).toBe(true);
    expect(hub.size).toBe(1);
    expect(logs().some((entry) => entry.msg === 'sse client dropped: not reading')).toBe(true);
    await new Promise((next) => setImmediate(next));
    expect(parseFrames(received.join('')).map((frame) => frame.event)).toEqual(['watchlist.changed']);

    hub.closeAll();
    expect(clock.pendingSleeps).toBe(0);
  });
});
