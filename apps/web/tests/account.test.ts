// Пользователи и сессии на клиенте (C6): запросы к /api/admin/* и /api/me/*, проверка форм, работа с кэшем.
import { QueryClient } from '@tanstack/react-query';
import { createAccountClient } from '@/lib/account/client';
import type { Profile, SessionDto, SessionList, UserDto, UserList } from '@/lib/account/contract';
import {
  countSessions,
  describeAccountFailure,
  describeUserAgent,
  lockReason,
  parseLogin,
  parsePasswordForm,
  problemSlug,
} from '@/lib/account/forms';
import {
  accountKeys,
  applyOwnSessionRevoked,
  applySessionRevoked,
  applyUserSaved,
  refreshAccount,
  removeSession,
  upsertUser,
} from '@/lib/account/queries';
import { BffError } from '@/lib/bff-client';
import { isActivePath, OPERATOR_SECTIONS, PROFILE_HREF } from '@/lib/navigation';

const T0 = '2026-10-12T12:00:00.000Z';

const user = (overrides: Partial<UserDto> = {}): UserDto => ({
  id: 1,
  login: 'alice',
  role: 'operator',
  isActive: true,
  createdAt: T0,
  lastLoginAt: T0,
  activeSessions: 1,
  mustChangePassword: false,
  ...overrides,
});

const session = (overrides: Partial<SessionDto> = {}): SessionDto => ({
  id: 'a'.repeat(32),
  userId: 1,
  login: 'alice',
  createdAt: T0,
  lastSeenAt: T0,
  expiresAt: '2026-10-12T14:00:00.000Z',
  ip: null,
  userAgent: null,
  isCurrent: false,
  ...overrides,
});

function problem(status: number, slug: string, headers: Record<string, string> = {}, detail?: string) {
  return Response.json(
    { type: `urn:cpt:web:problem:${slug}`, title: 'Ошибка', status, detail },
    { status, headers: { 'content-type': 'application/problem+json', ...headers } },
  );
}

type Call = { url: string; method: string; headers: Headers; body: string | undefined; credentials: unknown };

function setupClient(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const onUnauthorized = jest.fn();
  const client = createAccountClient({
    fetch: (input, init) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : undefined,
        credentials: init?.credentials,
      };
      calls.push(call);
      return Promise.resolve().then(() => reply(call));
    },
    onUnauthorized,
  });
  return { client, calls, onUnauthorized };
}

const failureOf = async (work: Promise<unknown>) => work.then(() => null).catch((error: unknown) => error);

describe('[account/client] запросы', () => {
  it('✅ чтение — GET на свой origin с cookie; признака фона нет: за запросом стоит открытый экран', async () => {
    const { client, calls } = setupClient(() => Response.json({ items: [user()] }));
    expect(await client.listUsers()).toEqual({ items: [user()] });
    await client.listSessions();
    await client.profile();
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/sessions'],
      ['GET', '/api/me/sessions'],
    ]);
    expect(calls[0]?.credentials).toBe('same-origin');
    expect(calls[0]?.headers.has('x-cpt-background')).toBe(false);
    expect(calls[0]?.headers.has('content-type')).toBe(false);
  });

  it('✅ запись — JSON-тело и Content-Type; у сброса пароля заголовок есть и без тела (слой CSRF)', async () => {
    const { client, calls } = setupClient(() =>
      Response.json({ user: user(), temporaryPassword: 'p', revokedSessions: 0 }),
    );
    await client.createUser({ login: 'bob', role: 'viewer' });
    await client.updateUser(7, { isActive: false });
    await client.resetPassword(7);
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['POST', '/api/admin/users', '{"login":"bob","role":"viewer"}'],
      ['PATCH', '/api/admin/users/7', '{"isActive":false}'],
      ['POST', '/api/admin/users/7/password-reset', undefined],
    ]);
    for (const call of calls) expect(call.headers.get('content-type')).toBe('application/json');
  });

  it('✅ отзыв и выход — DELETE без тела, ответ 204 → undefined', async () => {
    const { client, calls } = setupClient(() => new Response(null, { status: 204 }));
    expect(await client.revokeSession('a'.repeat(32))).toBeUndefined();
    await client.revokeOwnSession('b'.repeat(32));
    await client.logoutEverywhere();
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['DELETE', `/api/admin/sessions/${'a'.repeat(32)}`],
      ['DELETE', `/api/me/sessions/${'b'.repeat(32)}`],
      ['DELETE', '/api/me/sessions'],
    ]);
    expect(calls.every((call) => call.body === undefined && !call.headers.has('content-type'))).toBe(true);
  });

  it('✅ смена пароля — PUT; пароли уходят только в теле запроса', async () => {
    const { client, calls } = setupClient(() => new Response(null, { status: 204 }));
    await client.changePassword({ currentPassword: 'old password 123', newPassword: 'new password 456' });
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/me/password' });
    expect(calls[0]?.url).not.toContain('password 123');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      currentPassword: 'old password 123',
      newPassword: 'new password 456',
    });
  });

  it('❌ отказ — BffError с Problem; 401 дополнительно ведёт на вход', async () => {
    const conflict = setupClient(() => problem(409, 'last-operator'));
    const error = await failureOf(conflict.client.updateUser(1, { role: 'viewer' }));
    expect(error).toBeInstanceOf(BffError);
    expect(error).toMatchObject({ status: 409, source: 'web' });
    expect(problemSlug(error)).toBe('last-operator');
    expect(conflict.onUnauthorized).not.toHaveBeenCalled();

    const expired = setupClient(() => problem(401, 'unauthorized'));
    await failureOf(expired.client.listUsers());
    expect(expired.onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('[account/forms] проверка ввода', () => {
  it('✅ логин приводится к нижнему регистру и обрезается по краям — как на сервере', () => {
    expect(parseLogin('  Ivan.Petrov ')).toEqual({ ok: true, login: 'ivan.petrov' });
    expect(parseLogin('a_b-c.9')).toEqual({ ok: true, login: 'a_b-c.9' });
  });

  it.each([['ab'], ['иван'], ['ivan petrov'], ['x'.repeat(33)], [''], ['ivan@corp']])(
    '❌ логин %j отклонён',
    (input) => {
      expect(parseLogin(input).ok).toBe(false);
    },
  );

  it('✅ форма смены пароля: корректный ввод', () => {
    expect(parsePasswordForm({ currentPassword: 'old', newPassword: 'twelve chars', repeat: 'twelve chars' })).toEqual({
      ok: true,
    });
  });

  it.each([
    ['нет текущего', { currentPassword: '', newPassword: 'twelve chars', repeat: 'twelve chars' }, 'currentPassword'],
    ['новый короткий', { currentPassword: 'old', newPassword: 'short', repeat: 'short' }, 'newPassword'],
    [
      'новый длиннее 128',
      { currentPassword: 'old', newPassword: 'x'.repeat(129), repeat: 'x'.repeat(129) },
      'newPassword',
    ],
    [
      'новый равен текущему',
      { currentPassword: 'same password', newPassword: 'same password', repeat: 'same password' },
      'newPassword',
    ],
    ['повтор не совпал', { currentPassword: 'old', newPassword: 'twelve chars', repeat: 'twelve char' }, 'repeat'],
  ] as const)('❌ форма смены пароля: %s', (_, input, field) => {
    const parsed = parsePasswordForm(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.fields)).toEqual([field]);
  });
});

describe('[account/forms] отказ сервера → сообщение', () => {
  const describe_ = (status: number, slug: string, headers = {}, detail?: string) =>
    describeAccountFailure(
      new BffError(status, { type: `urn:cpt:web:problem:${slug}`, title: 'Заголовок', status, detail }, undefined, {
        retryAfterSeconds: 'retry-after' in headers ? Number((headers as Record<string, string>)['retry-after']) : null,
      }),
    );

  it.each([
    [409, 'login-taken', 'Такой логин уже есть'],
    [409, 'last-operator', 'последний активный оператор'],
    [409, 'own-password-reset', 'в профиле'],
    [422, 'invalid-current-password', 'Текущий пароль указан неверно'],
    [403, 'forbidden', 'Недостаточно прав'],
    [404, 'not-found', 'Список обновлён'],
  ])('✅ %i %s', (status, slug, expected) => {
    expect(describe_(status, slug)).toContain(expected);
  });

  it('✅ 429 — с отсчётом из Retry-After; без заголовка — без числа', () => {
    expect(describe_(429, 'too-many-attempts', { 'retry-after': '8' })).toBe(
      'Слишком много попыток. Повторите через 8 с.',
    );
    expect(describe_(429, 'too-many-attempts')).toBe('Слишком много попыток. Повторите позже.');
  });

  it('✅ незнакомый отказ — detail из Problem; нет сети — отдельный текст', () => {
    expect(describe_(400, 'validation-error', {}, 'Новый пароль совпадает с текущим')).toBe(
      'Новый пароль совпадает с текущим',
    );
    expect(describeAccountFailure(new BffError(0, null))).toContain('Нет связи');
    expect(describeAccountFailure(new Error('boom'))).toBe('Неизвестная ошибка.');
  });
});

describe('[account/forms] подсказки экрана', () => {
  it('✅ последний активный оператор заблокирован; отключённый оператор в счёт не идёт', () => {
    const alice = user();
    const bob = user({ id: 2, login: 'bob', role: 'viewer' });
    const carol = user({ id: 3, login: 'carol', isActive: false });
    expect(lockReason(alice, [alice, bob, carol])).toContain('Последний активный оператор');
    expect(lockReason(bob, [alice, bob, carol])).toBeNull();
    expect(lockReason(carol, [alice, bob, carol])).toBeNull();
    const dave = user({ id: 4, login: 'dave' });
    expect(lockReason(alice, [alice, dave])).toBeNull();
  });

  it('✅ склонение числа сессий', () => {
    expect([0, 1, 2, 5, 21].map(countSessions)).toEqual(['0 сессий', '1 сессия', '2 сессии', '5 сессий', '21 сессия']);
  });

  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Chrome · Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      'Edge · Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari · macOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Firefox · Linux'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
      'Chrome · iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Chrome · Android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 YaBrowser/25.8.0 Safari/537.36',
      'Яндекс Браузер · Windows',
    ],
    ['curl/8.9.1', 'curl/8.9.1'],
    [`agent-${'x'.repeat(60)}`, `agent-${'x'.repeat(34)}…`],
    ['', 'неизвестно'],
    [null, 'неизвестно'],
  ])('✅ User-Agent %j → %s', (userAgent, expected) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });
});

describe('[account/queries] результат мутации → кэш запросов', () => {
  function setup() {
    const queryClient = new QueryClient();
    const users: UserList = { items: [user(), user({ id: 2, login: 'carol', role: 'viewer' })] };
    const sessions: SessionList = {
      items: [session({ isCurrent: true }), session({ id: 'b'.repeat(32), userId: 2, login: 'carol' })],
    };
    const profile: Profile = { login: 'alice', role: 'operator', lastLoginAt: T0, sessions: sessions.items };
    queryClient.setQueryData(accountKeys.users, users);
    queryClient.setQueryData(accountKeys.sessions, sessions);
    queryClient.setQueryData(accountKeys.profile, profile);
    const isStale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    return { queryClient, isStale };
  }

  it('✅ новый пользователь встаёт по логину; существующий заменяется на месте', () => {
    const list: UserList = { items: [user(), user({ id: 2, login: 'carol' })] };
    const bob = user({ id: 3, login: 'bob', role: 'viewer' });
    expect(upsertUser(list, bob).items.map((item) => item.login)).toEqual(['alice', 'bob', 'carol']);
    const disabled = user({ id: 2, login: 'carol', isActive: false });
    expect(upsertUser(list, disabled).items).toEqual([user(), disabled]);
    expect(list.items).toHaveLength(2);
  });

  it('✅ смена роли без отозванных сессий: в кэше ответ сервера, список сессий не трогается', () => {
    const { queryClient, isStale } = setup();
    applyUserSaved(queryClient, user({ id: 2, login: 'carol', role: 'operator', activeSessions: 0 }));
    expect(queryClient.getQueryData<UserList>(accountKeys.users)?.items[1]).toMatchObject({ role: 'operator' });
    expect(isStale(accountKeys.sessions)).toBe(false);
    expect(isStale(accountKeys.users)).toBe(false);
  });

  it('✅ действие отозвало сессии: список сессий помечен устаревшим — в ответе его нет', () => {
    const { queryClient, isStale } = setup();
    applyUserSaved(queryClient, user({ id: 2, login: 'carol', isActive: false, activeSessions: 0 }), 1);
    expect(isStale(accountKeys.sessions)).toBe(true);
  });

  it('✅ список ещё не загружен — кэш не создаётся из одного пользователя', () => {
    const queryClient = new QueryClient();
    applyUserSaved(queryClient, user());
    expect(queryClient.getQueryData(accountKeys.users)).toBeUndefined();
  });

  it('✅ оператор отозвал сессию: строки нет, счётчики пользователей перечитываются', () => {
    const { queryClient, isStale } = setup();
    applySessionRevoked(queryClient, 'b'.repeat(32));
    expect(queryClient.getQueryData<SessionList>(accountKeys.sessions)?.items.map((item) => item.login)).toEqual([
      'alice',
    ]);
    expect(isStale(accountKeys.users)).toBe(true);
    expect(isStale(accountKeys.profile)).toBe(false);
  });

  it('✅ своя сессия завершена: её нет в профиле, остальное в профиле прежнее', () => {
    const { queryClient } = setup();
    applyOwnSessionRevoked(queryClient, 'b'.repeat(32));
    const profile = queryClient.getQueryData<Profile>(accountKeys.profile);
    expect(profile).toMatchObject({ login: 'alice', role: 'operator' });
    expect(profile?.sessions.map((item) => item.id)).toEqual(['a'.repeat(32)]);
    expect(removeSession([session()], 'нет такой')).toEqual([session()]);
  });

  it('❌ отказ действия: всё показанное помечается устаревшим', () => {
    const { queryClient, isStale } = setup();
    refreshAccount(queryClient);
    expect([accountKeys.users, accountKeys.sessions, accountKeys.profile].map(isStale)).toEqual([true, true, true]);
  });
});

describe('[navigation] пользователи и профиль', () => {
  it('✅ «Пользователи» — раздел оператора; профиль — вне панели оператора', () => {
    expect(OPERATOR_SECTIONS.map((section) => section.href)).toContain('/operator/users');
    expect(isActivePath('/operator/users', '/operator')).toBe(true);
    expect(isActivePath(PROFILE_HREF, '/operator')).toBe(false);
  });
});
