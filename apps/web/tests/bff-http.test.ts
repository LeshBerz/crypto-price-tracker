import { handleBff, MAX_BODY_BYTES } from '@/server/bff/bff-http';
import { IDLE_TIMEOUT_MS } from '@/server/sessions';
import type { Role } from '@/server/users';
import { createTestContext, TEST_API, type TestContext } from './helpers';

const ORIGIN = 'http://localhost:3100';

type Init = { method?: string; body?: unknown; rawBody?: string; headers?: Record<string, string>; token?: string };
type Call = { url: string; init: RequestInit };

function request(path: string, { method = 'GET', body, rawBody, headers = {}, token }: Init = {}): Request {
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Request(`${ORIGIN}/api/bff${path}`, {
    method,
    headers: {
      host: 'localhost:3100',
      ...(method === 'GET' ? {} : { origin: ORIGIN }),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { cookie: `theme=dark; cpt_session=${token}` } : {}),
      ...headers,
    },
    body: payload,
  });
}

const headersOf = (call: Call | undefined) => new Headers(call?.init.headers);

describe('[bff] /api/bff/[...path]', () => {
  let ctx: TestContext;
  let calls: Call[];
  let tokens: Record<Role, string>;

  /** api отвечает заданным ответом; каждый запрос записывается */
  function apiReplies(reply: () => Response): void {
    ctx.setApi((url, init) => {
      calls.push({ url, init });
      return Promise.resolve(reply());
    });
  }

  beforeEach(async () => {
    ctx = createTestContext();
    calls = [];
    const meta = { ip: null, userAgent: null };
    tokens = {
      viewer: ctx.sessions.create(await ctx.addUser('vera', 'correct horse battery', 'viewer'), meta).token,
      operator: ctx.sessions.create(await ctx.addUser('oleg', 'correct horse battery', 'operator'), meta).token,
    };
  });

  describe('успешный запрос', () => {
    it('✅ GET viewer: путь и параметры — как есть, ключ viewer, ответ api без изменений', async () => {
      apiReplies(() => Response.json({ data: [{ symbol: 'BTC' }] }, { headers: { 'x-request-id': 'from-api' } }));
      const response = await handleBff(request('/api/v1/prices?currency=USD&limit=5', { token: tokens.viewer }), ctx);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: [{ symbol: 'BTC' }] });
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-request-id')).toBe('from-api');

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(`${TEST_API.baseUrl}/api/v1/prices?currency=USD&limit=5`);
      expect(calls[0]?.init.method).toBe('GET');
      expect(headersOf(calls[0]).get('authorization')).toBe(`Bearer ${TEST_API.viewerKey}`);
      expect(headersOf(calls[0]).get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('✅ POST operator: ключ operator, тело и Content-Type переданы, 201 и Location возвращены', async () => {
      apiReplies(() => Response.json({ id: 7 }, { status: 201, headers: { location: '/api/v1/cryptocurrencies/7' } }));
      const response = await handleBff(
        request('/api/v1/cryptocurrencies', { method: 'POST', body: { symbol: 'ETH' }, token: tokens.operator }),
        ctx,
      );

      expect(response.status).toBe(201);
      expect(response.headers.get('location')).toBe('/api/v1/cryptocurrencies/7');
      expect(headersOf(calls[0]).get('authorization')).toBe(`Bearer ${TEST_API.operatorKey}`);
      expect(headersOf(calls[0]).get('content-type')).toBe('application/json');
      expect(new TextDecoder().decode(calls[0]?.init.body as ArrayBuffer)).toBe('{"symbol":"ETH"}');
    });

    it('✅ POST без тела (запуск синхронизации): 202 и Location', async () => {
      apiReplies(() => Response.json({ id: 3 }, { status: 202, headers: { location: '/api/v1/sync-runs/3' } }));
      const response = await handleBff(
        request('/api/v1/sync-runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          token: tokens.operator,
        }),
        ctx,
      );
      expect(response.status).toBe(202);
      expect(calls[0]?.init.body).toBeUndefined();
    });

    it('✅ DELETE: 204 без тела', async () => {
      apiReplies(() => new Response(null, { status: 204 }));
      const response = await handleBff(
        request('/api/v1/cryptocurrencies/7', { method: 'DELETE', token: tokens.operator }),
        ctx,
      );
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    });

    it('✅ ошибка api (Problem RFC 9457) и Retry-After проходят как есть', async () => {
      const body = { type: 'urn:cpt:problem:sync-in-progress', title: 'Синхронизация уже идёт', status: 409, runId: 3 };
      apiReplies(
        () =>
          new Response(JSON.stringify(body), {
            status: 409,
            headers: { 'content-type': 'application/problem+json; charset=utf-8', 'retry-after': '30' },
          }),
      );
      const response = await handleBff(
        request('/api/v1/sync-runs', { method: 'POST', body: {}, token: tokens.operator }),
        ctx,
      );
      expect(response.status).toBe(409);
      expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
      expect(response.headers.get('retry-after')).toBe('30');
      expect(await response.json()).toEqual(body);
    });
  });

  describe('что не покидает сервер', () => {
    it('✅ в api не уходят cookie сессии и посторонние заголовки браузера', async () => {
      apiReplies(() => Response.json({}));
      await handleBff(
        request('/api/v1/prices', {
          token: tokens.viewer,
          headers: { authorization: 'Bearer cpt_from_browser', 'x-request-id': 'from-browser', 'x-custom': '1' },
        }),
        ctx,
      );
      const sent = headersOf(calls[0]);
      expect(sent.get('cookie')).toBeNull();
      expect(sent.get('x-custom')).toBeNull();
      expect(sent.get('authorization')).toBe(`Bearer ${TEST_API.viewerKey}`);
      expect(sent.get('x-request-id')).not.toBe('from-browser');
    });

    it('✅ в браузер не уходят ключи api и заголовки вне списка разрешённых', async () => {
      apiReplies(() => Response.json({}, { headers: { 'set-cookie': 'a=1', server: 'express', 'x-internal': '1' } }));
      const response = await handleBff(request('/api/v1/prices', { token: tokens.operator }), ctx);
      const visible = JSON.stringify([...response.headers]) + (await response.text());
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('server')).toBeNull();
      expect(response.headers.get('x-internal')).toBeNull();
      expect(visible).not.toContain('cpt_');
    });
  });

  describe('отказы до запроса в api', () => {
    afterEach(() => expect(calls).toHaveLength(0));

    it.each([
      ['без cookie', undefined],
      ['с неизвестным токеном', 'A'.repeat(43)],
    ])('❌ 401 %s — даже для пути, которого нет в таблице', async (_name, token) => {
      const known = await handleBff(request('/api/v1/prices', { token }), ctx);
      const unknown = await handleBff(request('/api/v1/secret', { token }), ctx);
      expect(known.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(await known.json()).toMatchObject({ type: 'urn:cpt:web:problem:unauthorized', status: 401 });
    });

    it('❌ 401 после отзыва сессии', async () => {
      ctx.sessions.revoke(tokens.viewer, 'admin');
      expect((await handleBff(request('/api/v1/prices', { token: tokens.viewer }), ctx)).status).toBe(401);
    });

    it.each([
      ['поток событий', 'GET', '/api/v1/stream'],
      ['пути нет в контракте', 'GET', '/api/v1/api-keys'],
      ['метода нет у пути', 'PATCH', '/api/v1/prices'],
      ['выход из префикса через ..', 'GET', '/api/v1/cryptocurrencies/1/../../../../admin'],
      ['выход из префикса через %2e%2e', 'GET', '/api/v1/cryptocurrencies/%2e%2e/%2e%2e/%2e%2e/docs'],
    ])('❌ 404 %s', async (_name, method, path) => {
      const response = await handleBff(
        request(path, { method, body: method === 'GET' ? undefined : {}, token: tokens.operator }),
        ctx,
      );
      expect(response.status).toBe(404);
      const body = (await response.json()) as { type: string; requestId: string };
      expect(body.type).toBe('urn:cpt:web:problem:not-found');
      expect(body.requestId).toBe(response.headers.get('x-request-id'));
    });

    it.each([
      ['POST', '/api/v1/cryptocurrencies'],
      ['PATCH', '/api/v1/cryptocurrencies/1'],
      ['DELETE', '/api/v1/cryptocurrencies/1'],
      ['GET', '/api/v1/sync-runs'],
      ['POST', '/api/v1/sync-runs'],
      ['GET', '/api/v1/system/cmc'],
    ])('❌ 403 viewer: %s %s', async (method, path) => {
      const body = method === 'GET' || method === 'DELETE' ? undefined : {};
      const response = await handleBff(request(path, { method, body, token: tokens.viewer }), ctx);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ type: 'urn:cpt:web:problem:forbidden' });
    });

    it('❌ 415: POST не в JSON (форма с чужого сайта)', async () => {
      const response = await handleBff(
        request('/api/v1/cryptocurrencies', {
          method: 'POST',
          rawBody: 'symbol=ETH',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          token: tokens.operator,
        }),
        ctx,
      );
      expect(response.status).toBe(415);
    });

    it.each([
      ['чужой Origin', { origin: 'https://evil.example' }],
      ['без Origin', { origin: '' }],
    ])('❌ 403: мутация, %s', async (_name, headers) => {
      for (const method of ['POST', 'DELETE']) {
        const path = method === 'POST' ? '/api/v1/sync-runs' : '/api/v1/cryptocurrencies/1';
        const body = method === 'POST' ? {} : undefined;
        const response = await handleBff(request(path, { method, body, headers, token: tokens.operator }), ctx);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ type: 'urn:cpt:web:problem:forbidden-origin' });
      }
    });

    it('❌ 413: тело больше предела', async () => {
      const response = await handleBff(
        request('/api/v1/cryptocurrencies', {
          method: 'POST',
          rawBody: JSON.stringify({ symbol: 'x'.repeat(MAX_BODY_BYTES) }),
          token: tokens.operator,
        }),
        ctx,
      );
      expect(response.status).toBe(413);
    });
  });

  describe('срок бездействия', () => {
    const HOUR = 60 * 60 * 1000;

    it('✅ обычный запрос продлевает сессию', async () => {
      apiReplies(() => Response.json({}));
      ctx.advance(HOUR);
      await handleBff(request('/api/v1/prices', { token: tokens.viewer }), ctx);
      ctx.advance(IDLE_TIMEOUT_MS - 1);

      expect((await handleBff(request('/api/v1/prices', { token: tokens.viewer }), ctx)).status).toBe(200);
    });

    it('✅ фоновый запрос отвечает, но сессию не продлевает', async () => {
      apiReplies(() => Response.json({}));
      const background = { token: tokens.viewer, headers: { 'x-cpt-background': '1' } };
      ctx.advance(HOUR);
      expect((await handleBff(request('/api/v1/prices', background), ctx)).status).toBe(200);
      ctx.advance(HOUR);

      expect((await handleBff(request('/api/v1/prices', background), ctx)).status).toBe(401);
    });

    it('❌ признак фона на записи не действует: POST продлевает сессию', async () => {
      apiReplies(() => Response.json({}, { status: 202 }));
      ctx.advance(HOUR);
      const posted = await handleBff(
        request('/api/v1/sync-runs', {
          method: 'POST',
          body: {},
          token: tokens.operator,
          headers: { 'x-cpt-background': '1' },
        }),
        ctx,
      );
      expect(posted.status).toBe(202);
      ctx.advance(IDLE_TIMEOUT_MS - 1);

      expect((await handleBff(request('/api/v1/sync-runs', { token: tokens.operator }), ctx)).status).toBe(202);
    });
  });

  describe('api недоступен', () => {
    it('❌ 502 в формате Problem; в логе — код ошибки и requestId, ключа нет', async () => {
      ctx.setApi(() => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })));
      const response = await handleBff(request('/api/v1/sync-runs', { token: tokens.operator }), ctx);

      expect(response.status).toBe(502);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      const body = (await response.json()) as { type: string; requestId: string };
      expect(body.type).toBe('urn:cpt:web:problem:upstream-unavailable');

      expect(ctx.logs).toEqual([
        {
          level: 'warn',
          msg: 'api request failed',
          fields: {
            requestId: body.requestId,
            target: 'GET /api/v1/sync-runs',
            failure: 'unavailable',
            code: 'ECONNREFUSED',
          },
        },
      ]);
      expect(JSON.stringify(ctx.logs)).not.toContain('cpt_');
    });

    it('❌ 504: api не ответил за API_TIMEOUT_MS, запрос отменён', async () => {
      ctx = createTestContext({ api: { ...TEST_API, timeoutMs: 20 } });
      const token = ctx.sessions.create(await ctx.addUser('vera', 'correct horse battery'), {
        ip: null,
        userAgent: null,
      }).token;
      let aborted = false;
      ctx.setApi(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      );
      const response = await handleBff(request('/api/v1/prices', { token }), ctx);
      expect(response.status).toBe(504);
      expect(await response.json()).toMatchObject({ type: 'urn:cpt:web:problem:upstream-timeout' });
      expect(aborted).toBe(true);
      expect(ctx.logs[0]?.fields).toMatchObject({ failure: 'timeout' });
    });

    it('❌ 504: api отдал заголовки, но завис на теле', async () => {
      ctx = createTestContext({ api: { ...TEST_API, timeoutMs: 20 } });
      const token = ctx.sessions.create(await ctx.addUser('vera', 'correct horse battery'), {
        ip: null,
        userAgent: null,
      }).token;
      ctx.setApi((_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":['));
            init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
      });
      const response = await handleBff(request('/api/v1/prices', { token }), ctx);
      expect(response.status).toBe(504);
    });
  });
});
