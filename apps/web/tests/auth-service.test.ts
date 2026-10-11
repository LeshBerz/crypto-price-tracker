import { ATTEMPT_TTL_MS, FREE_ATTEMPTS, lockDelayMs, MAX_DELAY_MS } from '@/server/login-throttle';
import { createTestContext, type TestContext } from './helpers';

const PASSWORD = 'correct horse battery';
const META = { ip: '203.0.113.7', userAgent: 'jest' };

describe('задержка входа: расчёт', () => {
  it('первые 5 неудач — без ожидания, дальше 1 → 2 → 4 … секунд, не дольше 15 минут', () => {
    expect([0, 1, 4].map(lockDelayMs)).toEqual([0, 0, 0]);
    expect([5, 6, 7, 8].map(lockDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(lockDelayMs(15)).toBe(MAX_DELAY_MS);
    expect(lockDelayMs(100_000)).toBe(MAX_DELAY_MS);
  });
});

describe('вход по логину и паролю', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.addUser('alice', PASSWORD, 'operator');
  });

  const fail = async (times: number, login = 'alice', meta = META) => {
    for (let i = 0; i < times; i += 1) await ctx.auth.login(login, 'wrong password!!', meta);
  };

  it('✅ верные данные → сессия, роль и отметка последнего входа', async () => {
    const result = await ctx.auth.login('alice', PASSWORD, META);
    expect(result).toMatchObject({ ok: true, login: 'alice', role: 'operator' });
    if (!result.ok) throw new Error('unreachable');
    expect(ctx.sessions.validate(result.token)).toMatchObject({ login: 'alice' });
    expect(ctx.db.prepare('SELECT last_login_at FROM users WHERE login = ?').get('alice')).toEqual({
      last_login_at: ctx.now(),
    });
  });

  it('✅ логин не зависит от регистра и пробелов по краям', async () => {
    await expect(ctx.auth.login('  Alice ', PASSWORD, META)).resolves.toMatchObject({ ok: true, login: 'alice' });
  });

  it('❌ неверный пароль → отказ без сессии', async () => {
    await expect(ctx.auth.login('alice', 'wrong password!!', META)).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(ctx.db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('❌ неизвестный логин → тот же отказ, и scrypt всё равно считается', async () => {
    await expect(ctx.auth.login('mallory', PASSWORD, META)).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(ctx.verifyCalls).toHaveLength(1);
  });

  it('❌ логин вне формата → отказ без запроса пользователя, scrypt считается', async () => {
    await expect(ctx.auth.login("alice' OR 1=1 --", PASSWORD, META)).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(ctx.verifyCalls).toHaveLength(1);
  });

  it('❌ отключённый пользователь → тот же отказ, что и при неверном пароле', async () => {
    const user = ctx.users.findByLogin('alice');
    ctx.users.setActive(user?.id ?? 0, false, ctx.now());
    await expect(ctx.auth.login('alice', PASSWORD, META)).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('❌ пароль длиннее 128 символов отклоняется, даже если его начало верное', async () => {
    const long = PASSWORD + 'x'.repeat(200);
    await expect(ctx.auth.login('alice', long, META)).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('❌ после 5 неудач — ожидание; верный пароль во время ожидания не проверяется', async () => {
    await fail(FREE_ATTEMPTS);
    const calls = ctx.verifyCalls.length;
    await expect(ctx.auth.login('alice', PASSWORD, META)).resolves.toEqual({
      ok: false,
      reason: 'throttled',
      retryAfterMs: 1000,
    });
    expect(ctx.verifyCalls).toHaveLength(calls);
  });

  it('✅ ожидание растёт: 1 с → 2 с → 4 с, и по его истечении вход снова возможен', async () => {
    await fail(FREE_ATTEMPTS);
    ctx.advance(1000);
    await fail(1);
    await expect(ctx.auth.login('alice', PASSWORD, META)).resolves.toMatchObject({ retryAfterMs: 2000 });
    ctx.advance(2000);
    await fail(1);
    await expect(ctx.auth.login('alice', PASSWORD, META)).resolves.toMatchObject({ retryAfterMs: 4000 });
    ctx.advance(4000);
    await expect(ctx.auth.login('alice', PASSWORD, META)).resolves.toMatchObject({ ok: true });
  });

  it('✅ успешный вход сбрасывает счётчик неудач', async () => {
    await fail(FREE_ATTEMPTS - 1);
    await ctx.auth.login('alice', PASSWORD, META);
    await fail(FREE_ATTEMPTS - 1);
    await expect(ctx.auth.login('alice', PASSWORD, META)).resolves.toMatchObject({ ok: true });
  });

  it('✅ задержка считается по паре (логин, адрес): другой адрес и другой логин не ждут', async () => {
    await ctx.addUser('bob', PASSWORD);
    await fail(FREE_ATTEMPTS);
    await expect(ctx.auth.login('alice', PASSWORD, { ...META, ip: '198.51.100.9' })).resolves.toMatchObject({
      ok: true,
    });
    await expect(ctx.auth.login('bob', PASSWORD, META)).resolves.toMatchObject({ ok: true });
  });

  it('❌ неизвестный логин задерживается так же, как существующий (логины не перебираются)', async () => {
    await fail(FREE_ATTEMPTS, 'mallory');
    await expect(ctx.auth.login('mallory', PASSWORD, META)).resolves.toMatchObject({ reason: 'throttled' });
  });

  it('✅ очистка удаляет записи о неудачах старше суток', async () => {
    await fail(2);
    ctx.advance(ATTEMPT_TTL_MS - 1);
    expect(ctx.throttle.purgeStale(ctx.now())).toBe(0);
    ctx.advance(1);
    expect(ctx.throttle.purgeStale(ctx.now())).toBe(1);
  });
});
