import { clientIp, isSameOrigin } from '@/server/request';
import { handleLogin, handleLogout, handleWhoAmI } from '@/server/session-http';
import { FREE_ATTEMPTS } from '@/server/login-throttle';
import { createTestContext, type TestContext } from './helpers';

const ORIGIN = 'http://localhost:3001';
const URL_SESSION = `${ORIGIN}/api/session`;
const PASSWORD = 'correct horse battery';

type Init = { method?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string };

function request({ method = 'POST', body, rawBody, headers = {} }: Init = {}): Request {
  const hasBody = body !== undefined || rawBody !== undefined;
  return new Request(URL_SESSION, {
    method,
    headers: {
      host: 'localhost:3001',
      origin: ORIGIN,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

function cookieOf(response: Response): string {
  return response.headers.get('set-cookie') ?? '';
}

function tokenOf(response: Response): string {
  return /cpt_session=([^;]+)/.exec(cookieOf(response))?.[1] ?? '';
}

describe('[session] POST /api/session — вход', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.addUser('alice', PASSWORD, 'operator');
  });

  it('✅ 200: роль в теле, токен только в HttpOnly-cookie', async () => {
    const response = await handleLogin(request({ body: { login: 'alice', password: PASSWORD } }), ctx);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ login: 'alice', role: 'operator' });
    expect(cookieOf(response)).toMatch(
      /^cpt_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; SameSite=Lax$/,
    );
    expect(text).not.toContain(tokenOf(response));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('✅ по HTTPS cookie получает префикс __Host- и флаг Secure', async () => {
    const secure = new Request('https://tracker.example/api/session', {
      method: 'POST',
      headers: { host: 'tracker.example', origin: 'https://tracker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'alice', password: PASSWORD }),
    });
    expect(cookieOf(await handleLogin(secure, ctx))).toMatch(/^__Host-cpt_session=.+; Secure$/);
  });

  it('❌ 401: неверный пароль и неизвестный логин дают одинаковый ответ', async () => {
    const wrong = await handleLogin(request({ body: { login: 'alice', password: 'wrong password!!' } }), ctx);
    const unknown = await handleLogin(request({ body: { login: 'mallory', password: PASSWORD } }), ctx);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.text()).toBe(await unknown.text());
    expect(cookieOf(wrong)).toBe('');
    expect(wrong.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
  });

  it('❌ 429 + Retry-After после 5 неудач', async () => {
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) {
      await handleLogin(request({ body: { login: 'alice', password: 'wrong password!!' } }), ctx);
    }
    const response = await handleLogin(request({ body: { login: 'alice', password: PASSWORD } }), ctx);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toMatchObject({
      type: 'urn:cpt:web:problem:too-many-attempts',
      retryAfterSeconds: 1,
    });
  });

  it.each([
    ['битый JSON', { rawBody: '{"login":' }],
    ['не объект', { body: ['alice', PASSWORD] }],
    ['нет пароля', { body: { login: 'alice' } }],
    ['логин не строка', { body: { login: 42, password: PASSWORD } }],
    ['пустой логин', { body: { login: '', password: PASSWORD } }],
    ['пароль длиннее предела', { body: { login: 'alice', password: 'x'.repeat(1025) } }],
  ])('❌ 400: %s', async (_name, init) => {
    const response = await handleLogin(request(init), ctx);
    expect(response.status).toBe(400);
    expect(ctx.verifyCalls).toHaveLength(0);
  });

  it('❌ 415: тело не application/json (HTML-форма с чужого сайта)', async () => {
    const response = await handleLogin(
      request({ rawBody: 'login=alice', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      ctx,
    );
    expect(response.status).toBe(415);
  });

  it.each([
    ['чужой Origin', { origin: 'https://evil.example' }],
    ['Origin с другим портом', { origin: 'http://localhost:9999' }],
    ['Origin не URL', { origin: 'null' }],
  ])('❌ 403: %s', async (_name, headers) => {
    const response = await handleLogin(request({ body: { login: 'alice', password: PASSWORD }, headers }), ctx);
    expect(response.status).toBe(403);
    expect(ctx.verifyCalls).toHaveLength(0);
  });

  it('❌ 403: запрос без Origin', async () => {
    const bare = new Request(URL_SESSION, {
      method: 'POST',
      headers: { host: 'localhost:3001', 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'alice', password: PASSWORD }),
    });
    expect((await handleLogin(bare, ctx)).status).toBe(403);
  });
});

describe('[session] GET и DELETE /api/session', () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.addUser('alice', PASSWORD, 'viewer');
    token = tokenOf(await handleLogin(request({ body: { login: 'alice', password: PASSWORD } }), ctx));
  });

  const withCookie = (method: string, headers: Record<string, string> = {}) =>
    request({ method, headers: { cookie: `theme=dark; cpt_session=${token}`, ...headers } });

  it('✅ GET 200: логин и роль текущей сессии', async () => {
    const response = handleWhoAmI(withCookie('GET'), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ login: 'alice', role: 'viewer' });
  });

  it('❌ GET 401 без cookie', () => {
    expect(handleWhoAmI(request({ method: 'GET' }), ctx).status).toBe(401);
  });

  it('✅ DELETE 204: сессия отозвана на сервере, cookie стёрта', () => {
    const response = handleLogout(withCookie('DELETE'), ctx);
    expect(response.status).toBe(204);
    expect(cookieOf(response)).toBe('cpt_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    expect(ctx.sessions.validate(token)).toBeNull();
    expect(handleWhoAmI(withCookie('GET'), ctx).status).toBe(401);
  });

  it('✅ DELETE 204 без сессии: выход идемпотентен', () => {
    expect(handleLogout(request({ method: 'DELETE' }), ctx).status).toBe(204);
  });

  it('❌ DELETE 403 с чужого сайта: сессия остаётся', () => {
    const response = handleLogout(withCookie('DELETE', { origin: 'https://evil.example' }), ctx);
    expect(response.status).toBe(403);
    expect(ctx.sessions.validate(token)).not.toBeNull();
  });
});

describe('адрес клиента и Origin за обратным прокси', () => {
  const forwarded = new Request(URL_SESSION, {
    method: 'POST',
    headers: {
      host: 'web:3000',
      origin: 'https://tracker.example',
      'x-forwarded-host': 'tracker.example',
      'x-forwarded-for': '198.51.100.1, 203.0.113.7',
    },
  });

  it('без доверенного прокси заголовки X-Forwarded-* игнорируются', () => {
    expect(clientIp(forwarded, false)).toBeNull();
    expect(isSameOrigin(forwarded, false)).toBe(false);
  });

  it('с доверенным прокси берётся последний адрес из X-Forwarded-For и хост из X-Forwarded-Host', () => {
    expect(clientIp(forwarded, true)).toBe('203.0.113.7');
    expect(isSameOrigin(forwarded, true)).toBe(true);
  });
});
