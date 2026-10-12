// Пользователи и сессии (C6): маршруты /api/admin/* и /api/me/* на настоящей SQLite в памяти.
import { LOGIN_PATTERN, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/account/contract';
import type {
  CreateUserResponse,
  Profile,
  ResetPasswordResponse,
  SessionList,
  UpdateUserResponse,
  UserList,
} from '@/lib/account/contract';
import {
  handleChangePassword,
  handleCreateUser,
  handleListSessions,
  handleListUsers,
  handleLogoutEverywhere,
  handleProfile,
  handleResetPassword,
  handleRevokeOwnSession,
  handleRevokeSession,
  handleUpdateUser,
} from '@/server/account-http';
import { handleStream } from '@/server/bff/stream-http';
import { migrate, MIGRATIONS, openDatabase } from '@/server/db';
import { FREE_ATTEMPTS } from '@/server/login-throttle';
import * as passwords from '@/server/passwords';
import { hashToken, SESSION_ID_FORMAT } from '@/server/sessions';
import { generatePassword, isUserAdminError, UserAdminError } from '@/server/user-admin';
import { LOGIN_FORMAT } from '@/server/users';
import { createTestContext, START, type TestContext } from './helpers';

const ORIGIN = 'http://localhost:3001';
const PASSWORD = 'correct horse battery';
const META = { ip: null, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36' };
const MINUTE = 60_000;

type Init = {
  method?: string;
  token?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  origin?: string | null;
  /** Content-Type без тела: так клиент отправляет POST сброса пароля */
  json?: boolean;
};

function request(
  path: string,
  { method = 'GET', token, body, rawBody, headers = {}, origin = ORIGIN, json }: Init = {},
) {
  const hasBody = body !== undefined || rawBody !== undefined;
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      host: 'localhost:3001',
      ...(origin ? { origin } : {}),
      ...(hasBody || json ? { 'content-type': 'application/json' } : {}),
      ...(token ? { cookie: `cpt_session=${token}` } : {}),
      ...headers,
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

async function problemOf(response: Response): Promise<{ type: string; detail?: string; status: number }> {
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  return (await response.json()) as { type: string; detail?: string; status: number };
}

const slug = async (response: Response) => (await problemOf(response)).type.replace('urn:cpt:web:problem:', '');

describe('пользователи и сессии', () => {
  let ctx: TestContext;
  let aliceId: number;
  let bobId: number;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    ctx = createTestContext();
    aliceId = await ctx.addUser('alice', PASSWORD, 'operator');
    bobId = await ctx.addUser('bob', PASSWORD, 'viewer');
    alice = ctx.sessions.create(aliceId, META).token;
    bob = ctx.sessions.create(bobId, META).token;
  });

  const sessionRow = (token: string) =>
    ctx.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token)) as Record<string, unknown>;
  const userRow = (id: number) => ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;
  const canLogin = async (login: string, password: string) => (await ctx.auth.login(login, password, META)).ok;

  describe('[admin] общая охрана маршрутов', () => {
    const routes: [string, (token: string | undefined, init?: Init) => Response | Promise<Response>][] = [
      ['GET /api/admin/users', (token, init) => handleListUsers(request('/api/admin/users', { token, ...init }), ctx)],
      [
        'POST /api/admin/users',
        (token, init) =>
          handleCreateUser(
            request('/api/admin/users', { method: 'POST', token, body: { login: 'carol', role: 'viewer' }, ...init }),
            ctx,
          ),
      ],
      [
        'PATCH /api/admin/users/{id}',
        (token, init) =>
          handleUpdateUser(
            request('/api/admin/users/2', { method: 'PATCH', token, body: { role: 'operator' }, ...init }),
            ctx,
            '2',
          ),
      ],
      [
        'POST /api/admin/users/{id}/password-reset',
        (token, init) =>
          handleResetPassword(
            request('/api/admin/users/2/password-reset', { method: 'POST', token, json: true, ...init }),
            ctx,
            '2',
          ),
      ],
      [
        'GET /api/admin/sessions',
        (token, init) => handleListSessions(request('/api/admin/sessions', { token, ...init }), ctx),
      ],
      [
        'DELETE /api/admin/sessions/{id}',
        (token, init) =>
          handleRevokeSession(
            request('/api/admin/sessions/x', { method: 'DELETE', token, ...init }),
            ctx,
            'a'.repeat(32),
          ),
      ],
    ];

    it.each(routes)('❌ %s без сессии → 401', async (_, call) => {
      const response = await call(undefined);
      expect(response.status).toBe(401);
      expect(await slug(response)).toBe('unauthorized');
    });

    it.each(routes)('❌ %s под Viewer → 403: роль проверяет сервер, а не скрытый пункт меню', async (_, call) => {
      const response = await call(bob);
      expect(response.status).toBe(403);
      expect(await slug(response)).toBe('forbidden');
    });

    it.each(routes.filter(([name]) => !name.startsWith('GET')))(
      '❌ %s с чужого сайта → 403 forbidden-origin (CSRF)',
      async (_, call) => {
        for (const origin of ['https://evil.example', null]) {
          const response = await call(alice, { origin });
          expect(response.status).toBe(403);
          expect(await slug(response)).toBe('forbidden-origin');
        }
        // Ни одна мутация не выполнена
        expect(ctx.users.list(ctx.now())).toHaveLength(2);
        expect(userRow(bobId).role).toBe('viewer');
        expect(ctx.sessions.validate(bob)).not.toBeNull();
      },
    );

    it('❌ запись без Content-Type: application/json → 415 (HTML-форма такой заголовок не отправит)', async () => {
      const create = await handleCreateUser(
        request('/api/admin/users', {
          method: 'POST',
          token: alice,
          rawBody: 'login=carol&role=operator',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        }),
        ctx,
      );
      expect(create.status).toBe(415);
      const reset = await handleResetPassword(
        request('/api/admin/users/2/password-reset', { method: 'POST', token: alice }),
        ctx,
        '2',
      );
      expect(reset.status).toBe(415);
      expect(await canLogin('bob', PASSWORD)).toBe(true);
    });
  });

  describe('[listUsers] GET /api/admin/users', () => {
    it('✅ 200: пользователи по логину, число действующих сессий, без хэшей паролей', async () => {
      ctx.sessions.create(bobId, META);
      ctx.sessions.revoke(ctx.sessions.create(bobId, META).token, 'logout');
      ctx.users.markLogin(bobId, START + MINUTE);
      const response = handleListUsers(request('/api/admin/users', { token: alice }), ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const text = await response.text();
      expect(text).not.toContain('scrypt$');
      expect((JSON.parse(text) as UserList).items).toEqual([
        {
          id: aliceId,
          login: 'alice',
          role: 'operator',
          isActive: true,
          createdAt: new Date(START).toISOString(),
          lastLoginAt: null,
          activeSessions: 1,
          mustChangePassword: false,
        },
        {
          id: bobId,
          login: 'bob',
          role: 'viewer',
          isActive: true,
          createdAt: new Date(START).toISOString(),
          lastLoginAt: new Date(START + MINUTE).toISOString(),
          activeSessions: 2,
          mustChangePassword: false,
        },
      ]);
    });

    it('✅ истёкшая сессия в счётчик не входит', async () => {
      ctx.advance(3 * 60 * MINUTE);
      const fresh = ctx.sessions.create(aliceId, META).token;
      const { items } = (await handleListUsers(request('/api/admin/users', { token: fresh }), ctx).json()) as UserList;
      expect(items.map((user) => user.activeSessions)).toEqual([1, 0]);
    });
  });

  describe('[createUser] POST /api/admin/users', () => {
    const create = (body: unknown) =>
      handleCreateUser(request('/api/admin/users', { method: 'POST', token: alice, body }), ctx);

    it('✅ 201: временный пароль создаёт сервер и отдаёт один раз; в БД — только хэш', async () => {
      const response = await create({ login: '  Carol.Smith ', role: 'viewer' });
      expect(response.status).toBe(201);
      const { user, temporaryPassword } = (await response.json()) as CreateUserResponse;
      expect(user).toMatchObject({ login: 'carol.smith', role: 'viewer', isActive: true, activeSessions: 0 });
      expect(temporaryPassword).toMatch(/^[A-Za-z0-9_-]{20}$/);
      expect(String(userRow(user.id).password_hash)).toMatch(/^scrypt\$/);
      expect(JSON.stringify(ctx.db.prepare('SELECT * FROM users').all())).not.toContain(temporaryPassword);
      expect(JSON.stringify(ctx.logs)).not.toContain(temporaryPassword);
      expect(await canLogin('carol.smith', temporaryPassword)).toBe(true);
    });

    it('✅ пароли разных пользователей разные и проходят политику длины', () => {
      const generated = new Set(Array.from({ length: 50 }, generatePassword));
      expect(generated.size).toBe(50);
      for (const password of generated) expect(passwords.isAcceptablePassword(password)).toBe(true);
    });

    it('❌ 409 login-taken: логин занят, в том числе в другом регистре', async () => {
      const response = await create({ login: 'BOB', role: 'viewer' });
      expect(response.status).toBe(409);
      expect(await slug(response)).toBe('login-taken');
      expect(ctx.users.list(ctx.now())).toHaveLength(2);
    });

    it.each([
      ['логин короче трёх символов', { login: 'ab', role: 'viewer' }],
      ['логин с пробелом внутри', { login: 'car ol', role: 'viewer' }],
      ['логин не строка', { login: 42, role: 'viewer' }],
      ['неизвестная роль', { login: 'carol', role: 'admin' }],
      ['роли нет', { login: 'carol' }],
      ['лишнее поле: пароль задаёт сервер, а не оператор', { login: 'carol', role: 'viewer', password: PASSWORD }],
      ['массив вместо объекта', [{ login: 'carol', role: 'viewer' }]],
    ])('❌ 400: %s', async (_, body) => {
      const response = await create(body);
      expect(response.status).toBe(400);
      expect(await slug(response)).toBe('validation-error');
      expect(ctx.users.list(ctx.now())).toHaveLength(2);
    });

    it('❌ 400: тело не JSON или больше предела', async () => {
      const send = (rawBody: string) =>
        handleCreateUser(request('/api/admin/users', { method: 'POST', token: alice, rawBody }), ctx);
      expect((await send('{login:')).status).toBe(400);
      expect((await send(JSON.stringify({ login: 'x'.repeat(5000), role: 'viewer' }))).status).toBe(400);
    });
  });

  describe('[updateUser] PATCH /api/admin/users/{id}', () => {
    const update = (id: number | string, body: unknown, token = alice) =>
      handleUpdateUser(request(`/api/admin/users/${id}`, { method: 'PATCH', token, body }), ctx, String(id));

    it('✅ смена роли отзывает все сессии пользователя (причина admin)', async () => {
      const second = ctx.sessions.create(bobId, META).token;
      const response = await update(bobId, { role: 'operator' });
      expect(response.status).toBe(200);
      const body = (await response.json()) as UpdateUserResponse;
      expect(body).toMatchObject({ user: { id: bobId, role: 'operator', activeSessions: 0 }, revokedSessions: 2 });
      expect(ctx.sessions.validate(bob)).toBeNull();
      expect(ctx.sessions.validate(second)).toBeNull();
      expect(sessionRow(bob).revoke_reason).toBe('admin');
      // Сессии оператора, выполнившего действие, не тронуты
      expect(ctx.sessions.validate(alice)).not.toBeNull();
    });

    it('✅ отключение отзывает сессии (причина user_disabled) и закрывает вход; включение вход возвращает', async () => {
      const disabled = (await (await update(bobId, { isActive: false })).json()) as UpdateUserResponse;
      expect(disabled).toMatchObject({ user: { isActive: false, activeSessions: 0 }, revokedSessions: 1 });
      expect(sessionRow(bob).revoke_reason).toBe('user_disabled');
      expect(await canLogin('bob', PASSWORD)).toBe(false);

      const enabled = (await (await update(bobId, { isActive: true })).json()) as UpdateUserResponse;
      expect(enabled).toMatchObject({ user: { isActive: true }, revokedSessions: 0 });
      // Прежняя сессия не оживает: отзыв необратим
      expect(ctx.sessions.validate(bob)).toBeNull();
      expect(await canLogin('bob', PASSWORD)).toBe(true);
    });

    it('✅ то же значение — ничего не меняется и сессии не отзываются', async () => {
      const body = (await (await update(bobId, { role: 'viewer', isActive: true })).json()) as UpdateUserResponse;
      expect(body.revokedSessions).toBe(0);
      expect(ctx.sessions.validate(bob)).not.toBeNull();
      expect(userRow(bobId).updated_at).toBe(START);
    });

    it.each([
      ['понизить', { role: 'viewer' }],
      ['отключить', { isActive: false }],
    ])('❌ 409 last-operator: нельзя %s последнего активного оператора', async (_, patch) => {
      const response = await update(aliceId, patch);
      expect(response.status).toBe(409);
      expect(await slug(response)).toBe('last-operator');
      expect(userRow(aliceId)).toMatchObject({ role: 'operator', is_active: 1 });
      expect(ctx.sessions.validate(alice)).not.toBeNull();
    });

    it('❌ отключённый оператор не считается: единственный активный остаётся защищён', async () => {
      const carolId = await ctx.addUser('carol', PASSWORD, 'operator');
      ctx.users.setActive(carolId, false, ctx.now());
      expect((await update(aliceId, { role: 'viewer' })).status).toBe(409);
    });

    it('✅ операторов двое: себя понизить можно — и своя сессия при этом завершается', async () => {
      await ctx.addUser('carol', PASSWORD, 'operator');
      const response = await update(aliceId, { role: 'viewer' });
      expect(response.status).toBe(200);
      expect(((await response.json()) as UpdateUserResponse).revokedSessions).toBe(1);
      expect(ctx.sessions.validate(alice)).toBeNull();
      expect(ctx.users.countActiveOperators()).toBe(1);
    });

    it('❌ отказ не оставляет половины изменений: роль и статус в одном запросе', async () => {
      const response = await update(aliceId, { role: 'viewer', isActive: false });
      expect(response.status).toBe(409);
      expect(userRow(aliceId)).toMatchObject({ role: 'operator', is_active: 1, updated_at: START });
    });

    it('❌ 404: пользователя нет или идентификатор не число', async () => {
      expect((await update(999, { role: 'viewer' })).status).toBe(404);
      expect((await update('1;DROP', { role: 'viewer' })).status).toBe(404);
      expect((await update('01', { role: 'viewer' })).status).toBe(404);
    });

    it.each([
      ['пустой объект', {}],
      ['роль не из списка', { role: 'root' }],
      ['isActive строкой', { isActive: 'false' }],
      ['неизвестное поле', { login: 'eve' }],
    ])('❌ 400: %s', async (_, body) => {
      const response = await update(bobId, body);
      expect(response.status).toBe(400);
      expect(userRow(bobId)).toMatchObject({ login: 'bob', role: 'viewer', is_active: 1 });
    });
  });

  describe('[resetPassword] POST /api/admin/users/{id}/password-reset', () => {
    const reset = (id: number) =>
      handleResetPassword(
        request(`/api/admin/users/${id}/password-reset`, { method: 'POST', token: alice, json: true }),
        ctx,
        String(id),
      );

    it('✅ 200: новый временный пароль, старый не подходит, сессии отозваны (password_changed)', async () => {
      const response = await reset(bobId);
      expect(response.status).toBe(200);
      const body = (await response.json()) as ResetPasswordResponse;
      expect(body).toMatchObject({ user: { login: 'bob', activeSessions: 0 }, revokedSessions: 1 });
      expect(sessionRow(bob).revoke_reason).toBe('password_changed');
      expect(await canLogin('bob', PASSWORD)).toBe(false);
      expect(await canLogin('bob', body.temporaryPassword)).toBe(true);
      expect(JSON.stringify(ctx.logs)).not.toContain(body.temporaryPassword);
      expect(userRow(bobId).password_changed_at).toBe(START);
    });

    it('❌ 409 own-password-reset: ответ с паролем пришёл бы в отозванную сессию', async () => {
      const response = await reset(aliceId);
      expect(response.status).toBe(409);
      expect(await slug(response)).toBe('own-password-reset');
      expect(await canLogin('alice', PASSWORD)).toBe(true);
      expect(ctx.sessions.validate(alice)).not.toBeNull();
    });

    it('❌ 404: пользователя нет', async () => {
      expect((await reset(999)).status).toBe(404);
    });
  });

  describe('[sessions] GET /api/admin/sessions, DELETE /api/admin/sessions/{id}', () => {
    const list = async (token = alice) =>
      ((await handleListSessions(request('/api/admin/sessions', { token }), ctx).json()) as SessionList).items;
    const revoke = (id: string, token = alice) =>
      handleRevokeSession(request(`/api/admin/sessions/${id}`, { method: 'DELETE', token }), ctx, id);

    it('✅ 200: действующие сессии всех пользователей; текущая помечена; хэш токена не выдаётся', async () => {
      const response = handleListSessions(request('/api/admin/sessions', { token: alice }), ctx);
      const text = await response.text();
      expect(text).not.toContain(hashToken(alice));
      expect(text).not.toContain(hashToken(bob));
      const items = (JSON.parse(text) as SessionList).items;
      expect(items).toHaveLength(2);
      expect(items.find((item) => item.login === 'alice')).toMatchObject({
        userId: aliceId,
        isCurrent: true,
        ip: null,
        userAgent: META.userAgent,
        createdAt: new Date(START).toISOString(),
        expiresAt: new Date(START + 2 * 60 * MINUTE).toISOString(),
      });
      expect(items.find((item) => item.login === 'bob')?.isCurrent).toBe(false);
      for (const item of items) expect(item.id).toMatch(SESSION_ID_FORMAT);
    });

    it('✅ отозванные, истёкшие и сессии отключённого пользователя в список не попадают', async () => {
      const carolId = await ctx.addUser('carol', PASSWORD);
      ctx.sessions.create(carolId, META);
      ctx.users.setActive(carolId, false, ctx.now());
      ctx.sessions.revoke(bob, 'logout');
      expect((await list()).map((item) => item.login)).toEqual(['alice']);
      ctx.advance(3 * 60 * MINUTE);
      const fresh = ctx.sessions.create(aliceId, META).token;
      expect(await list(fresh)).toHaveLength(1);
    });

    it('✅ 204: отозванная сессия перестаёт действовать сразу (причина admin)', async () => {
      const id = (await list()).find((item) => item.login === 'bob')?.id ?? '';
      const response = revoke(id);
      expect(response.status).toBe(204);
      expect(ctx.sessions.validate(bob)).toBeNull();
      expect(sessionRow(bob)).toMatchObject({ revoke_reason: 'admin', revoked_at: START });
      expect(ctx.sessions.validate(alice)).not.toBeNull();
    });

    it('❌ 404: повторный отзыв, неизвестный идентификатор, идентификатор не того формата', async () => {
      const id = (await list()).find((item) => item.login === 'bob')?.id ?? '';
      expect(revoke(id).status).toBe(204);
      expect(revoke(id).status).toBe(404);
      expect(revoke('f'.repeat(32)).status).toBe(404);
      // Хэш токена идентификатором не является: зная его, отозвать сессию нельзя
      expect(revoke(hashToken(alice)).status).toBe(404);
      expect(ctx.sessions.validate(alice)).not.toBeNull();
    });

    it('✅ отзыв закрывает открытый поток событий этой сессии на ближайшем heartbeat (ui-flows §4.4)', async () => {
      let upstream!: ReadableStreamDefaultController<Uint8Array>;
      ctx.setApi(() =>
        Promise.resolve(
          new Response(new ReadableStream<Uint8Array>({ start: (controller) => void (upstream = controller) }), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
        ),
      );
      const stream = await handleStream(
        new Request(`${ORIGIN}/api/stream`, { headers: { cookie: `cpt_session=${bob}` } }),
        ctx,
      );
      expect(stream.status).toBe(200);
      if (!stream.body) throw new Error('у потока нет тела');
      const reader = stream.body.getReader();
      const decoder = new TextDecoder();
      const send = (text: string) => upstream.enqueue(new TextEncoder().encode(text));
      const heartbeat = 'id: 1\nevent: heartbeat\ndata: {}\n\n';

      send(heartbeat);
      expect(decoder.decode((await reader.read()).value)).toBe(heartbeat);

      const id = (await list()).find((item) => item.login === 'bob')?.id ?? '';
      expect(revoke(id).status).toBe(204);

      send(heartbeat);
      expect(decoder.decode((await reader.read()).value)).toContain('event: session.expired');
      expect((await reader.read()).done).toBe(true);
      // Переподключение с той же cookie — 401
      const again = await handleStream(
        new Request(`${ORIGIN}/api/stream`, { headers: { cookie: `cpt_session=${bob}` } }),
        ctx,
      );
      expect(again.status).toBe(401);
    });
  });

  describe('[me] GET /api/me/sessions', () => {
    it('✅ 200 под любой ролью: свои сессии, текущая помечена, чужих нет', async () => {
      ctx.users.markLogin(bobId, START);
      ctx.advance(5 * MINUTE);
      const phone = ctx.sessions.create(bobId, { ip: null, userAgent: 'phone' }).token;
      const response = handleProfile(request('/api/me/sessions', { token: bob }), ctx);
      expect(response.status).toBe(200);
      const profile = (await response.json()) as Profile;
      expect(profile).toMatchObject({ login: 'bob', role: 'viewer', lastLoginAt: new Date(START).toISOString() });
      // От недавно активных к давним
      expect(profile.sessions.map((s) => [s.userAgent, s.isCurrent])).toEqual([
        ['phone', false],
        [META.userAgent, true],
      ]);
      expect(profile.sessions.every((s) => s.login === 'bob')).toBe(true);
      expect(ctx.sessions.validate(phone)).not.toBeNull();
    });

    it('❌ 401 без сессии', () => {
      expect(handleProfile(request('/api/me/sessions'), ctx).status).toBe(401);
    });
  });

  describe('[me] DELETE /api/me/sessions/{id} — завершить одну сессию', () => {
    const idOf = (token: string) => String(sessionRow(token).public_id);
    const revoke = (id: string, token: string, init: Init = {}) =>
      handleRevokeOwnSession(request(`/api/me/sessions/${id}`, { method: 'DELETE', token, ...init }), ctx, id);

    it('✅ 204: другая своя сессия завершена, текущая действует, cookie не трогается', () => {
      const phone = ctx.sessions.create(bobId, META).token;
      const response = revoke(idOf(phone), bob);
      expect(response.status).toBe(204);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(ctx.sessions.validate(phone)).toBeNull();
      expect(sessionRow(phone).revoke_reason).toBe('logout');
      expect(ctx.sessions.validate(bob)).not.toBeNull();
    });

    it('✅ 204: завершение текущей — это выход, cookie стирается', () => {
      const response = revoke(idOf(bob), bob);
      expect(response.status).toBe(204);
      expect(response.headers.get('set-cookie')).toMatch(/^cpt_session=; Path=\/; Max-Age=0/);
      expect(ctx.sessions.validate(bob)).toBeNull();
    });

    it('❌ 404: чужая сессия неотличима от несуществующей и остаётся действующей', () => {
      expect(revoke(idOf(alice), bob).status).toBe(404);
      expect(revoke('0'.repeat(32), bob).status).toBe(404);
      expect(revoke('не-идентификатор', bob).status).toBe(404);
      expect(ctx.sessions.validate(alice)).not.toBeNull();
    });

    it('❌ 403 с чужого сайта, 401 без сессии', () => {
      expect(revoke(idOf(bob), bob, { origin: 'https://evil.example' }).status).toBe(403);
      expect(ctx.sessions.validate(bob)).not.toBeNull();
      expect(handleRevokeOwnSession(request('/api/me/sessions/x', { method: 'DELETE' }), ctx, idOf(bob)).status).toBe(
        401,
      );
    });
  });

  describe('[me] DELETE /api/me/sessions — выйти на всех устройствах', () => {
    it('✅ 204: отозваны все свои сессии, включая текущую; чужие не тронуты', () => {
      const phone = ctx.sessions.create(bobId, META).token;
      const response = handleLogoutEverywhere(request('/api/me/sessions', { method: 'DELETE', token: bob }), ctx);
      expect(response.status).toBe(204);
      expect(response.headers.get('set-cookie')).toMatch(/^cpt_session=; Path=\/; Max-Age=0/);
      expect(ctx.sessions.validate(bob)).toBeNull();
      expect(ctx.sessions.validate(phone)).toBeNull();
      expect(sessionRow(phone).revoke_reason).toBe('logout_all');
      expect(ctx.sessions.validate(alice)).not.toBeNull();
    });

    it('❌ 403 с чужого сайта: сессии остаются', () => {
      const response = handleLogoutEverywhere(
        request('/api/me/sessions', { method: 'DELETE', token: bob, origin: 'https://evil.example' }),
        ctx,
      );
      expect(response.status).toBe(403);
      expect(ctx.sessions.validate(bob)).not.toBeNull();
    });
  });

  describe('[me] PUT /api/me/password — смена своего пароля', () => {
    const NEW_PASSWORD = 'staple battery horse correct';
    const change = (body: unknown, init: Init = {}) =>
      handleChangePassword(request('/api/me/password', { method: 'PUT', token: bob, body, ...init }), ctx);

    it('✅ 204: новый пароль действует, старый нет, все сессии отозваны, нужен новый вход', async () => {
      const phone = ctx.sessions.create(bobId, META).token;
      ctx.advance(MINUTE);
      const response = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(response.status).toBe(204);
      expect(response.headers.get('set-cookie')).toMatch(/^cpt_session=; Path=\/; Max-Age=0/);
      expect(ctx.sessions.validate(bob)).toBeNull();
      expect(ctx.sessions.validate(phone)).toBeNull();
      expect(sessionRow(phone).revoke_reason).toBe('password_changed');
      expect(userRow(bobId).password_changed_at).toBe(START + MINUTE);
      expect(JSON.stringify(ctx.db.prepare('SELECT * FROM users').all())).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(ctx.logs)).not.toContain(NEW_PASSWORD);
      expect(await canLogin('bob', PASSWORD)).toBe(false);
      expect(await canLogin('bob', NEW_PASSWORD)).toBe(true);
      expect(ctx.sessions.validate(alice)).not.toBeNull();
    });

    it('❌ 422 invalid-current-password: украденная сессия без пароля его не сменит', async () => {
      const response = await change({ currentPassword: 'wrong wrong wrong', newPassword: NEW_PASSWORD });
      expect(response.status).toBe(422);
      expect(await slug(response)).toBe('invalid-current-password');
      expect(await canLogin('bob', PASSWORD)).toBe(true);
      expect(ctx.sessions.validate(bob)).not.toBeNull();
    });

    it('❌ 429: перебор текущего пароля упирается в ту же задержку, что и вход', async () => {
      for (let attempt = 0; attempt < FREE_ATTEMPTS; attempt += 1) {
        expect((await change({ currentPassword: `wrong password ${attempt}`, newPassword: NEW_PASSWORD })).status).toBe(
          422,
        );
      }
      const before = ctx.verifyCalls.length;
      const blocked = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBe('1');
      // Во время ожидания пароль не проверяется: верный пароль неотличим от неверного
      expect(ctx.verifyCalls.length).toBe(before);
      ctx.advance(1000);
      expect((await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(204);
    });

    it.each([
      ['новый короче 12 символов', { currentPassword: PASSWORD, newPassword: 'short' }],
      ['новый длиннее 128 символов', { currentPassword: PASSWORD, newPassword: 'x'.repeat(129) }],
      ['новый совпадает с текущим', { currentPassword: PASSWORD, newPassword: PASSWORD }],
      ['нет текущего пароля', { newPassword: NEW_PASSWORD }],
      ['пароль не строка', { currentPassword: PASSWORD, newPassword: 123456789012 }],
      ['лишнее поле', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, role: 'operator' }],
    ])('❌ 400: %s', async (_, body) => {
      const response = await change(body);
      expect(response.status).toBe(400);
      expect(await slug(response)).toBe('validation-error');
      expect(await canLogin('bob', PASSWORD)).toBe(true);
      expect(ctx.sessions.validate(bob)).not.toBeNull();
    });

    it('❌ 415 без JSON, 403 с чужого сайта, 401 без сессии', async () => {
      const body = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD };
      expect((await change(body, { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
      expect((await change(body, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await change(body, { token: undefined })).status).toBe(401);
      expect(await canLogin('bob', PASSWORD)).toBe(true);
    });
  });
});

describe('[user-admin] доменная ошибка узнаётся без instanceof', () => {
  it('✅ ошибка из другого экземпляра модуля (другой чанк сборки Next) распознаётся по имени', () => {
    // Тот же класс, объявленный второй раз, — так выглядит модуль, попавший в два чанка
    class UserAdminErrorCopy extends Error {
      override name = 'UserAdminError';
      readonly kind = 'login-taken';
    }
    const foreign = new UserAdminErrorCopy('Логин уже занят');
    expect(foreign instanceof UserAdminError).toBe(false);
    expect(isUserAdminError(foreign)).toBe(true);
    expect(isUserAdminError(new UserAdminError('not-found', 'нет'))).toBe(true);
    expect(isUserAdminError(new Error('UserAdminError'))).toBe(false);
    expect(isUserAdminError({ name: 'UserAdminError', kind: 'not-found' })).toBe(false);
  });
});

describe('[contract] общие константы клиента и сервера', () => {
  it('✅ формат логина и границы длины пароля в контракте совпадают с серверными', () => {
    expect(LOGIN_PATTERN.source).toBe(LOGIN_FORMAT.source);
    expect(PASSWORD_MIN_LENGTH).toBe(passwords.PASSWORD_MIN_LENGTH);
    expect(PASSWORD_MAX_LENGTH).toBe(passwords.PASSWORD_MAX_LENGTH);
  });
});

describe('[migrations] 0002: открытый идентификатор сессии', () => {
  it('✅ сессии, созданные до миграции, получают разные идентификаторы; токен по ним не восстановить', () => {
    const db = openDatabase(':memory:');
    migrate(db, START, MIGRATIONS.slice(0, 1));
    const hash = `scrypt$10$8$1$${'A'.repeat(22)}$${'A'.repeat(43)}`;
    db.prepare(
      `INSERT INTO users (id, login, password_hash, role, created_at, updated_at, password_changed_at)
       VALUES (1, 'alice', ?, 'operator', ?, ?, ?)`,
    ).run(hash, START, START, START);
    const insert = db.prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES (?, 1, ?, ?, ?, ?)`,
    );
    insert.run('a'.repeat(64), START, START, START + 1, START + 2);
    insert.run('b'.repeat(64), START, START, START + 1, START + 2);

    expect(migrate(db, START + 1, MIGRATIONS.slice(0, 2))).toEqual([2]);
    const ids = db
      .prepare('SELECT public_id FROM sessions ORDER BY token_hash')
      .all()
      .map((row) => String(row.public_id));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(SESSION_ID_FORMAT);
    expect(ids[0]).not.toBe(ids[1]);
    expect('a'.repeat(64)).not.toContain(ids[0] as string);
  });

  it('❌ идентификатор уникален и ограничен форматом', () => {
    const ctx = createTestContext();
    const insert = (publicId: string, tokenHash: string) =>
      ctx.db
        .prepare(
          `INSERT INTO sessions (token_hash, public_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
           VALUES (?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(tokenHash, publicId, START, START, START + 1, START + 2);
    ctx.users.create('alice', `scrypt$10$8$1$${'A'.repeat(22)}$${'A'.repeat(43)}`, 'viewer', START);
    insert('c'.repeat(32), 'a'.repeat(64));
    expect(() => insert('c'.repeat(32), 'b'.repeat(64))).toThrow(/UNIQUE/);
    expect(() => insert('C'.repeat(32), 'b'.repeat(64))).toThrow(/CHECK/);
    expect(() => insert('c'.repeat(31), 'b'.repeat(64))).toThrow(/CHECK/);
  });
});
