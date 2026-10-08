// Конвейер роутера из спеки на настоящем контракте: auth → Content-Type → JSON → валидация → хендлер → ошибки.
// Хендлеры здесь тестовые: проверяется сам роутер, а не бизнес-логика операций.
import { gzipSync } from 'node:zlib';
import express from 'express';
import request from 'supertest';
import { errorHandler, notFound } from '../../src/http/errors.ts';
import { HttpProblem } from '../../src/http/problem.ts';
import { requestContext } from '../../src/http/request-context.ts';
import { hasBody, mountFromSpec, RESPONDED, type Handlers } from '../../src/http/router.ts';
import { bearer, fakeAuthenticator, TOKENS } from '../helpers/auth.ts';
import { spec } from '../helpers/contract.ts';
import { FakeClock } from '../helpers/fake-clock.ts';
import { createSpyLogger } from '../helpers/logger.ts';

const CRYPTO = {
  id: 7,
  cmcId: 1,
  symbol: 'BTC',
  name: 'Bitcoin',
  isPaused: false,
  lastUpdatedAt: null,
  createdAt: '2026-10-07T12:00:00.000Z',
  updatedAt: '2026-10-07T12:00:00.000Z',
  latestPrice: null,
};

function buildApp(overrides: Partial<Handlers>) {
  const unused = () => {
    throw new Error('хендлер не должен вызываться в этом тесте');
  };
  const handlers = {
    ...Object.fromEntries(spec.operations.map((op) => [op.operationId, unused])),
    ...overrides,
  } as Handlers;
  const clock = new FakeClock();
  const { logger, entries } = createSpyLogger(clock);
  const app = express();
  app.use(requestContext({ logger, clock }));
  app.use(mountFromSpec({ spec, handlers, authenticator: fakeAuthenticator }));
  app.use(notFound);
  app.use(errorHandler);
  return { app, logs: entries };
}

describe('роутер: аутентификация и scopes (RFC 6750)', () => {
  const { app } = buildApp({
    listLatestPrices: () => ({ status: 200, body: { currency: 'USD', lastSync: null, items: [] } }),
  });

  it('без Authorization → 401 и WWW-Authenticate: Bearer без error', async () => {
    const res = await request(app).get('/api/v1/prices');
    expect(res).toMatchContract('listLatestPrices', 401);
    expect(res).toBeProblem(401, 'unauthorized');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['неизвестный ключ', 'Bearer unknown-token'],
    ['не Bearer', `Basic ${TOKENS.viewer}`],
    ['мусор вместо токена', 'Bearer a b'],
  ])('%s → 401 invalid_token', async (_case, header) => {
    const res = await request(app).get('/api/v1/prices').set('Authorization', header);
    expect(res).toMatchContract('listLatestPrices', 401);
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('схема Bearer регистронезависима', async () => {
    const res = await request(app).get('/api/v1/prices').set('Authorization', `bearer ${TOKENS.viewer}`);
    expect(res).toMatchContract('listLatestPrices', 200);
  });

  it('нет нужного scope → 403 insufficient_scope со списком требуемых', async () => {
    const res = await request(app).get('/api/v1/prices').set(bearer(TOKENS.opsWriteOnly));
    expect(res).toMatchContract('listLatestPrices', 403);
    expect(res.headers['www-authenticate']).toBe('Bearer error="insufficient_scope", scope="prices:read"');
    expect(res.body.detail).toBe('API key lacks required scope: prices:read');
  });

  it('публичная операция не требует ключа', async () => {
    const { app: publicApp } = buildApp({ getLiveness: () => ({ status: 200, body: { status: 'ok' } }) });
    expect(await request(publicApp).get('/health/live')).toMatchContract('getLiveness', 200);
  });

  it('auth идёт до валидации: без ключа — 401, даже если запрос невалиден', async () => {
    const res = await request(app).get('/api/v1/prices?unknown=1');
    expect(res.status).toBe(401);
  });
});

describe('роутер: валидация и типизированный вход', () => {
  it('хендлер получает приведённый вход, principal и логгер с operationId', async () => {
    const { app, logs } = buildApp({
      listPriceHistory: ({ input, principal, log }) => {
        log.info('handled', { input });
        expect(principal?.keyId).toBe(1);
        return { status: 200, body: { cryptocurrencyId: input.path.id, currency: 'USD', items: [], nextCursor: null } };
      },
    });
    const res = await request(app)
      .get('/api/v1/cryptocurrencies/7/prices?from=2026-10-06T00:00:00Z')
      .set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listPriceHistory', 200);
    expect(logs().find((e) => e.msg === 'handled')).toMatchObject({
      operationId: 'listPriceHistory',
      keyId: 1,
      input: { path: { id: 7 }, query: { from: '2026-10-06T00:00:00Z', limit: 100 } },
    });
  });

  it('невалидный запрос → 400 со всеми ошибками и путями', async () => {
    const { app } = buildApp({});
    const res = await request(app)
      .get('/api/v1/cryptocurrencies/abc/prices?limit=1001&from=2026-10-06T00:00:00&x=1')
      .set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listPriceHistory', 400);
    expect(res).toBeProblem(400, 'validation-error');
    expect(res.body).toMatchObject({
      detail: 'Request has 4 invalid fields',
      instance: '/api/v1/cryptocurrencies/abc/prices',
      errors: [
        { path: '/path/id', message: 'must be integer' },
        { path: '/query/x', message: 'is not allowed' },
        { path: '/query/from', message: expect.stringContaining('date-time') },
        { path: '/query/limit', message: 'must be <= 1000' },
      ],
    });
  });

  it('тело: строгая проверка без приведения типов, лишнее поле → 400', async () => {
    const { app } = buildApp({});
    const res = await request(app)
      .post('/api/v1/cryptocurrencies')
      .set(bearer(TOKENS.operator))
      .send({ symbol: 'btc', cmcId: '1', isAdmin: true });
    expect(res).toMatchContract('createCryptocurrency', 400);
    expect(res.body.errors).toEqual([
      { path: '/body/isAdmin', message: 'is not allowed' },
      { path: '/body/symbol', message: 'must match pattern ^[A-Z0-9]{1,15}$' },
      { path: '/body/cmcId', message: 'must be integer' },
    ]);
  });

  it('тело — не JSON-объект или битый JSON → 400', async () => {
    const { app } = buildApp({});
    const send = (body: string) =>
      request(app)
        .post('/api/v1/cryptocurrencies')
        .set(bearer(TOKENS.operator))
        .set('Content-Type', 'application/json')
        .send(body);
    const broken = await send('{"symbol":');
    expect(broken).toMatchContract('createCryptocurrency', 400);
    expect(broken.body.errors).toEqual([{ path: '/body', message: 'must be valid JSON' }]);
    // express.json strict: верхним уровнем допустимы только объект и массив
    expect((await send('"BTC"')).body.errors).toEqual([{ path: '/body', message: 'must be valid JSON' }]);
    expect((await send('[]')).body.errors).toEqual([{ path: '/body', message: 'must be object' }]);
  });

  it('обязательное тело не прислали → 400 /body is required', async () => {
    const { app } = buildApp({});
    const res = await request(app).post('/api/v1/cryptocurrencies').set(bearer(TOKENS.operator));
    expect(res).toMatchContract('createCryptocurrency', 400);
    expect(res.body.errors).toEqual([{ path: '/body', message: 'is required' }]);
  });

  it('тело у операции без тела → 400; POST без тела (Content-Length: 0) — норма', async () => {
    const { app } = buildApp({
      triggerSyncRun: () => {
        throw new HttpProblem(409, 'sync-already-running', { conflictingId: 42 });
      },
    });
    const withBody = await request(app).post('/api/v1/sync-runs').set(bearer(TOKENS.operator)).send({ force: true });
    expect(withBody).toMatchContract('triggerSyncRun', 400);
    expect(withBody.body.errors).toEqual([{ path: '/body', message: 'must be empty: operation has no request body' }]);

    const empty = await request(app).post('/api/v1/sync-runs').set(bearer(TOKENS.operator));
    expect(empty).toMatchContract('triggerSyncRun', 409);
    expect(empty.body).toMatchObject({ type: 'urn:cpt:problem:sync-already-running', conflictingId: 42 });
  });
});

describe('роутер: 413 и 415', () => {
  const { app } = buildApp({});
  const post = () => request(app).post('/api/v1/cryptocurrencies').set(bearer(TOKENS.operator));

  it('не application/json → 415', async () => {
    const res = await post().set('Content-Type', 'text/plain').send('symbol=BTC');
    expect(res).toMatchContract('createCryptocurrency', 415);
    expect(res).toBeProblem(415, 'unsupported-media-type');
  });

  it('сжатое тело не распаковывается → 415 (защита от zip-бомбы)', async () => {
    const res = await post()
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send(gzipSync(JSON.stringify({ symbol: 'BTC' })));
    expect(res).toMatchContract('createCryptocurrency', 415);
  });

  it('кодировка не UTF-8 → 415', async () => {
    const res = await post().set('Content-Type', 'application/json; charset=koi8-r').send('{"symbol":"BTC"}');
    expect(res).toMatchContract('createCryptocurrency', 415);
  });

  it('тело больше 16 КБ → 413', async () => {
    const res = await post().send({ symbol: 'BTC', padding: 'x'.repeat(16 * 1024) });
    expect(res).toMatchContract('createCryptocurrency', 413);
    expect(res.body.detail).toBe('Request body exceeds 16kb');
  });
});

describe('роутер: ответы хендлеров', () => {
  it('заголовки из ответа (Location) и тело по контракту', async () => {
    const { app } = buildApp({
      createCryptocurrency: ({ input }) => ({
        status: 201,
        headers: { Location: `/api/v1/cryptocurrencies/${CRYPTO.id}` },
        body: { ...CRYPTO, symbol: input.body.symbol },
      }),
    });
    const res = await request(app)
      .post('/api/v1/cryptocurrencies')
      .set(bearer(TOKENS.operator))
      .send({ symbol: 'ETH' });
    expect(res).toMatchContract('createCryptocurrency', 201);
    expect(res.headers.location).toBe('/api/v1/cryptocurrencies/7');
    expect(res.body.symbol).toBe('ETH');
  });

  it('204 без тела', async () => {
    const { app } = buildApp({ deleteCryptocurrency: () => ({ status: 204 }) });
    const res = await request(app).delete('/api/v1/cryptocurrencies/7').set(bearer(TOKENS.operator));
    expect(res).toMatchContract('deleteCryptocurrency', 204);
    expect(res.text).toBe('');
  });

  it('RESPONDED: хендлер пишет ответ сам (SSE)', async () => {
    const { app } = buildApp({
      streamEvents: ({ res }) => {
        res.status(200).type('text/event-stream').end('event: heartbeat\ndata: {}\n\n');
        return RESPONDED;
      },
    });
    const res = await request(app).get('/api/v1/stream').set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('streamEvents', 200);
  });

  it('HttpProblem из хендлера — с заголовками (Retry-After)', async () => {
    const { app } = buildApp({
      createCryptocurrency: () => {
        throw new HttpProblem(503, 'upstream-unavailable', { headers: { 'Retry-After': '30' } });
      },
    });
    const res = await request(app)
      .post('/api/v1/cryptocurrencies')
      .set(bearer(TOKENS.operator))
      .send({ symbol: 'BTC' });
    expect(res).toMatchContract('createCryptocurrency', 503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.body.title).toBe('Upstream unavailable');
  });

  it('непредвиденная ошибка → 500 без деталей наружу, детали — в лог по requestId', async () => {
    const { app, logs } = buildApp({
      getCryptocurrency: async () => {
        throw new Error('SQLITE_CORRUPT: secret internals');
      },
    });
    const res = await request(app).get('/api/v1/cryptocurrencies/7').set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('getCryptocurrency', 500);
    expect(res.text).not.toContain('SQLITE_CORRUPT');
    const error = logs().find((e) => e.level === 'error');
    expect(error).toMatchObject({
      msg: 'request failed',
      requestId: res.headers['x-request-id'],
      status: 500,
      error: { message: 'SQLITE_CORRUPT: secret internals' },
    });
  });

  it('ошибка после начала ответа — соединение рвётся, Problem не дописывается', async () => {
    const { app, logs } = buildApp({
      streamEvents: ({ res }) => {
        res.status(200).type('text/event-stream').write('event: heartbeat\n');
        throw new Error('stream broke');
      },
    });
    await expect(request(app).get('/api/v1/stream').set(bearer(TOKENS.viewer))).rejects.toThrow();
    expect(logs().some((e) => e.msg === 'request failed')).toBe(true);
  });
});

describe('роутер: 404 и 405 (поправка R2 к ADR 0014)', () => {
  const { app } = buildApp({ getLiveness: () => ({ status: 200, body: { status: 'ok' } }) });

  it('неизвестный путь → 404 Problem, а не HTML Express', async () => {
    const res = await request(app).get('/api/v2/prices?x=1');
    expect(res).toBeProblem(404, 'not-found');
    expect(res.body).toMatchObject({ detail: 'No route for GET /api/v2/prices', instance: '/api/v2/prices' });
  });

  it('известный путь, чужой метод → 405 + Allow', async () => {
    const res = await request(app).delete('/health/live');
    expect(res).toBeProblem(405, 'method-not-allowed');
    expect(res.headers.allow).toBe('GET, HEAD');
    const watchlist = await request(app).put('/api/v1/cryptocurrencies/1');
    expect(watchlist.headers.allow).toBe('GET, PATCH, DELETE, HEAD');
  });

  it('405 не требует ключа: метод проверяется до auth', async () => {
    const res = await request(app).put('/api/v1/prices');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });

  it('HEAD обслуживается GET-хендлером без тела', async () => {
    const res = await request(app).head('/health/live');
    expect(res.status).toBe(200);
    expect(res.text ?? '').toBe('');
  });
});

describe('errorHandler: прочие ошибки чтения тела', () => {
  function appFailingWith(error: Error) {
    const { logger } = createSpyLogger();
    const app = express();
    app.use(requestContext({ logger, clock: new FakeClock() }));
    app.use((_req, _res, next) => next(error));
    app.use(errorHandler);
    return app;
  }
  const bodyError = (type: string, status: number) => Object.assign(new Error(type), { type, status });

  it('4xx от body-parser (обрыв, неверная длина) → 400: виноват запрос, а не сервер', async () => {
    const res = await request(appFailingWith(bodyError('request.aborted', 400))).post('/x');
    expect(res).toBeProblem(400, 'validation-error');
    expect(res.body.errors).toEqual([{ path: '/body', message: 'could not be read' }]);
  });

  it('5xx от body-parser → 500 internal-error', async () => {
    const res = await request(appFailingWith(bodyError('stream.encoding.set', 500))).post('/x');
    expect(res).toBeProblem(500, 'internal-error');
  });
});

describe('mountFromSpec', () => {
  it('операция без хендлера — ошибка при монтировании (fail-fast)', () => {
    expect(() => mountFromSpec({ spec, handlers: {} as Handlers, authenticator: fakeAuthenticator })).toThrow(
      'Нет хендлера для операции getLiveness',
    );
  });
});

describe('hasBody', () => {
  const req = (headers: Record<string, string>) =>
    ({ get: (name: string) => headers[name.toLowerCase()] }) as Parameters<typeof hasBody>[0];
  it.each([
    [{}, false],
    [{ 'content-length': '0' }, false],
    [{ 'content-length': '2' }, true],
    [{ 'transfer-encoding': 'chunked' }, true],
  ])('%p → %p', (headers, expected) => {
    expect(hasBody(req(headers))).toBe(expected);
  });
});
