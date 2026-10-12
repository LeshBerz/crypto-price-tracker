// Обязательная смена временного пароля (ADR 0016, поправка 35): пароль, выданный оператором, даёт сессию,
// с которой доступна только смена пароля.
import type { CreateUserResponse, Profile, ResetPasswordResponse, UserList } from '@/lib/account/contract';
import {
  handleChangePassword,
  handleCreateUser,
  handleListUsers,
  handleLogoutEverywhere,
  handleProfile,
  handleResetPassword,
} from '@/server/account-http';
import { handleBff } from '@/server/bff/bff-http';
import { handleStream } from '@/server/bff/stream-http';
import { migrate, MIGRATIONS, openDatabase } from '@/server/db';
import { handleLogout } from '@/server/session-http';
import { createTestContext, START, type TestContext } from './helpers';

const ORIGIN = 'http://localhost:3001';
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'staple battery horse correct';
const META = { ip: null, userAgent: null };

type Init = { method?: string; token?: string; body?: unknown; json?: boolean };

function request(path: string, { method = 'GET', token, body, json }: Init = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      host: 'localhost:3001',
      origin: ORIGIN,
      ...(body !== undefined || json ? { 'content-type': 'application/json' } : {}),
      ...(token ? { cookie: `cpt_session=${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const slug = async (response: Response) =>
  ((await response.json()) as { type: string }).type.replace('urn:cpt:web:problem:', '');

describe('[temporary-password] обязательная смена временного пароля', () => {
  let ctx: TestContext;
  let operator: string;

  /** Оператор создаёт пользователя; тот входит с выданным паролем */
  async function issue(login = 'carol'): Promise<{ id: number; password: string; token: string }> {
    const response = await handleCreateUser(
      request('/api/admin/users', { method: 'POST', token: operator, body: { login, role: 'viewer' } }),
      ctx,
    );
    const created = (await response.json()) as CreateUserResponse;
    expect(created.user.mustChangePassword).toBe(true);
    const signedIn = await ctx.auth.login(login, created.temporaryPassword, META);
    if (!signedIn.ok) throw new Error('вход с временным паролем не удался');
    return { id: created.user.id, password: created.temporaryPassword, token: signedIn.token };
  }

  const changePassword = (token: string, currentPassword: string, newPassword = NEW_PASSWORD) =>
    handleChangePassword(
      request('/api/me/password', { method: 'PUT', token, body: { currentPassword, newPassword } }),
      ctx,
    );

  beforeEach(async () => {
    ctx = createTestContext();
    operator = ctx.sessions.create(await ctx.addUser('alice', PASSWORD, 'operator'), META).token;
    ctx.setApi(() => Promise.resolve(new Response('{"items":[]}', { status: 200 })));
  });

  it('✅ пароль, заданный не оператором, смены не требует: первый оператор из окружения и существующие строки', () => {
    expect(ctx.sessions.validate(operator)?.mustChangePassword).toBe(false);
    ctx.users.bootstrapOperator('root', `scrypt$10$8$1$${'A'.repeat(22)}$${'A'.repeat(43)}`, START);
    expect(ctx.users.list(START).map((user) => [user.login, user.mustChangePassword])).toEqual([
      ['alice', false],
      ['root', false],
    ]);
  });

  it('✅ после создания пользователя сессия с выданным паролем помечена, оператор видит признак в списке', async () => {
    const carol = await issue();
    expect(ctx.sessions.validate(carol.token)).toMatchObject({ login: 'carol', mustChangePassword: true });

    const list = (await (
      await handleListUsers(request('/api/admin/users', { token: operator }), ctx)
    ).json()) as UserList;
    expect(list.items.find((user) => user.login === 'carol')?.mustChangePassword).toBe(true);
  });

  it('✅ сброс пароля оператором снова требует смены', async () => {
    const carol = await issue();
    expect((await changePassword(carol.token, carol.password)).status).toBe(204);
    expect(ctx.users.summary(carol.id, ctx.now())?.mustChangePassword).toBe(false);

    const reset = (await (
      await handleResetPassword(
        request(`/api/admin/users/${carol.id}/password-reset`, { method: 'POST', token: operator, json: true }),
        ctx,
        String(carol.id),
      )
    ).json()) as ResetPasswordResponse;
    expect(reset.user.mustChangePassword).toBe(true);
  });

  describe('что закрыто, пока пароль не сменён', () => {
    it.each([
      ['GET /api/me/sessions', (token: string) => handleProfile(request('/api/me/sessions', { token }), ctx)],
      [
        'DELETE /api/me/sessions',
        (token: string) => handleLogoutEverywhere(request('/api/me/sessions', { method: 'DELETE', token }), ctx),
      ],
      ['GET /api/bff/api/v1/prices', (token: string) => handleBff(request('/api/bff/api/v1/prices', { token }), ctx)],
      ['GET /api/stream', (token: string) => handleStream(request('/api/stream', { token }), ctx)],
    ])('❌ 403 password-change-required: %s', async (_name, call) => {
      const carol = await issue();
      const response = await call(carol.token);
      expect(response.status).toBe(403);
      expect(await slug(response)).toBe('password-change-required');
    });

    it('❌ запрос в api с временным паролем не уходит', async () => {
      const carol = await issue();
      let calls = 0;
      ctx.setApi(() => {
        calls += 1;
        return Promise.resolve(new Response('{}', { status: 200 }));
      });
      await handleBff(request('/api/bff/api/v1/prices', { token: carol.token }), ctx);
      await handleStream(request('/api/stream', { token: carol.token }), ctx);
      expect(calls).toBe(0);
    });

    it('✅ выход остаётся доступным: на экране смены пароля нельзя оказаться запертым', async () => {
      const carol = await issue();
      const response = await handleLogout(request('/api/session', { method: 'DELETE', token: carol.token }), ctx);
      expect(response.status).toBe(204);
      expect(ctx.sessions.validate(carol.token)).toBeNull();
    });
  });

  describe('смена пароля', () => {
    it('✅ 204: признак снят, прежние сессии отозваны, с новым паролем доступны данные', async () => {
      const carol = await issue();
      const response = await changePassword(carol.token, carol.password);
      expect(response.status).toBe(204);
      expect(ctx.sessions.validate(carol.token)).toBeNull();

      const again = await ctx.auth.login('carol', NEW_PASSWORD, META);
      if (!again.ok) throw new Error('вход с новым паролем не удался');
      expect(ctx.sessions.validate(again.token)?.mustChangePassword).toBe(false);
      const profile = await handleProfile(request('/api/me/sessions', { token: again.token }), ctx);
      expect(profile.status).toBe(200);
      expect(((await profile.json()) as Profile).login).toBe('carol');
      expect((await handleBff(request('/api/bff/api/v1/prices', { token: again.token }), ctx)).status).toBe(200);
    });

    it('❌ 422: неверный временный пароль — признак остаётся', async () => {
      const carol = await issue();
      const response = await changePassword(carol.token, 'not the issued password');
      expect(response.status).toBe(422);
      expect(ctx.sessions.validate(carol.token)?.mustChangePassword).toBe(true);
    });

    it('❌ 400: новый пароль совпадает с временным — признак остаётся', async () => {
      const carol = await issue();
      const response = await changePassword(carol.token, carol.password, carol.password);
      expect(response.status).toBe(400);
      expect(ctx.sessions.validate(carol.token)?.mustChangePassword).toBe(true);
    });
  });
});

describe('[migrations] 0003: признак временного пароля', () => {
  it('✅ существующие пользователи получают 0, значение вне 0 и 1 отклоняется', () => {
    const db = openDatabase(':memory:');
    migrate(db, START, MIGRATIONS.slice(0, 2));
    db.prepare(
      `INSERT INTO users (login, password_hash, role, created_at, updated_at, password_changed_at)
       VALUES ('alice', ?, 'viewer', ?, ?, ?)`,
    ).run(`scrypt$10$8$1$${'A'.repeat(22)}$${'A'.repeat(43)}`, START, START, START);

    expect(migrate(db, START)).toEqual([3]);
    expect(db.prepare('SELECT must_change_password FROM users').get()).toEqual({ must_change_password: 0 });
    expect(() => db.exec('UPDATE users SET must_change_password = 2')).toThrow(/CHECK/);
  });
});
