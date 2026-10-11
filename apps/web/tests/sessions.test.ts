import { ABSOLUTE_TIMEOUT_MS, hashToken, IDLE_TIMEOUT_MS, TOUCH_INTERVAL_MS } from '@/server/sessions';
import { createTestContext, type TestContext } from './helpers';

const META = { ip: '203.0.113.7', userAgent: 'jest' };
const MINUTE = 60 * 1000;

describe('серверные сессии', () => {
  let ctx: TestContext;
  let userId: number;

  beforeEach(async () => {
    ctx = createTestContext();
    userId = await ctx.addUser('alice', 'correct horse battery', 'operator');
  });

  const row = (token: string) =>
    ctx.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token)) as Record<string, unknown>;

  it('✅ токен — 256 бит в base64url; в БД лежит только его SHA-256', () => {
    const { token } = ctx.sessions.create(userId, META);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const dump = JSON.stringify(ctx.db.prepare('SELECT * FROM sessions').all());
    expect(dump).not.toContain(token);
    expect(dump).toContain(hashToken(token));
  });

  it('✅ действующая сессия возвращает пользователя и роль', () => {
    const { token } = ctx.sessions.create(userId, META);
    expect(ctx.sessions.validate(token)).toMatchObject({ userId, login: 'alice', role: 'operator' });
  });

  it('✅ каждый вход создаёт новый токен (session fixation)', () => {
    const first = ctx.sessions.create(userId, META).token;
    const second = ctx.sessions.create(userId, META).token;
    expect(second).not.toBe(first);
    expect(ctx.sessions.validate(first)).not.toBeNull();
    expect(ctx.sessions.validate(second)).not.toBeNull();
  });

  it.each([
    ['нет cookie', undefined],
    ['пустая строка', ''],
    ['не base64url', 'x'.repeat(42) + '!'],
    ['неверная длина', 'a'.repeat(44)],
    ['чужой токен того же формата', 'a'.repeat(43)],
  ])('❌ %s — сессии нет', (_name, token) => {
    ctx.sessions.create(userId, META);
    expect(ctx.sessions.validate(token)).toBeNull();
  });

  it('❌ истекает после 2 часов бездействия', () => {
    const { token } = ctx.sessions.create(userId, META);
    ctx.advance(IDLE_TIMEOUT_MS - 1);
    expect(ctx.sessions.validate(token)).not.toBeNull();
    ctx.advance(IDLE_TIMEOUT_MS);
    expect(ctx.sessions.validate(token)).toBeNull();
  });

  it('❌ истекает через 12 часов даже при постоянной активности', () => {
    const { token } = ctx.sessions.create(userId, META);
    for (let elapsed = 0; elapsed < ABSOLUTE_TIMEOUT_MS - 30 * MINUTE; elapsed += 30 * MINUTE) {
      ctx.advance(30 * MINUTE);
      expect(ctx.sessions.validate(token)).not.toBeNull();
    }
    ctx.advance(30 * MINUTE);
    expect(ctx.sessions.validate(token)).toBeNull();
  });

  it('✅ активность продлевает срок бездействия, но не дальше абсолютного предела', () => {
    const { token, expiresAt: absolute } = ctx.sessions.create(userId, META);
    ctx.advance(60 * MINUTE);
    expect(ctx.sessions.validate(token)?.expiresAt).toBe(ctx.now() + IDLE_TIMEOUT_MS);
    for (let hour = 2; hour <= 10; hour += 1) {
      ctx.advance(60 * MINUTE);
      ctx.sessions.validate(token);
    }
    // прошло 10,5 ч: до абсолютного предела меньше 2 часов, дальше него срок не продлевается
    ctx.advance(30 * MINUTE);
    expect(ctx.sessions.validate(token)?.expiresAt).toBe(absolute);
  });

  it('✅ last_seen_at пишется не чаще раза в минуту', () => {
    const { token } = ctx.sessions.create(userId, META);
    const created = Number(row(token).last_seen_at);
    ctx.advance(TOUCH_INTERVAL_MS - 1);
    ctx.sessions.validate(token);
    expect(Number(row(token).last_seen_at)).toBe(created);
    ctx.advance(1);
    ctx.sessions.validate(token);
    expect(Number(row(token).last_seen_at)).toBe(created + TOUCH_INTERVAL_MS);
  });

  it('✅ выход отзывает сессию сразу и записывает причину', () => {
    const { token } = ctx.sessions.create(userId, META);
    expect(ctx.sessions.revoke(token, 'logout')).toBe(true);
    expect(ctx.sessions.validate(token)).toBeNull();
    expect(row(token)).toMatchObject({ revoke_reason: 'logout', revoked_at: ctx.now() });
    // повторный выход ничего не меняет
    expect(ctx.sessions.revoke(token, 'logout')).toBe(false);
  });

  it('✅ «выйти везде» отзывает все сессии пользователя и не трогает чужие', async () => {
    const bobId = await ctx.addUser('bob', 'another long password');
    const mine = [ctx.sessions.create(userId, META).token, ctx.sessions.create(userId, META).token];
    const bobs = ctx.sessions.create(bobId, META).token;
    expect(ctx.sessions.revokeAllForUser(userId, 'logout_all')).toBe(2);
    expect(mine.map((token) => ctx.sessions.validate(token))).toEqual([null, null]);
    expect(ctx.sessions.validate(bobs)).not.toBeNull();
  });

  it('❌ отключённый пользователь теряет доступ с действующей сессией', () => {
    const { token } = ctx.sessions.create(userId, META);
    ctx.users.setActive(userId, false, ctx.now());
    expect(ctx.sessions.validate(token)).toBeNull();
  });

  it('✅ очистка удаляет только истёкшие сессии', () => {
    const old = ctx.sessions.create(userId, META).token;
    ctx.advance(IDLE_TIMEOUT_MS + 1);
    const fresh = ctx.sessions.create(userId, META).token;
    expect(ctx.sessions.purgeExpired()).toBe(1);
    expect(row(old)).toBeUndefined();
    expect(ctx.sessions.validate(fresh)).not.toBeNull();
  });

  it('✅ адрес и браузер обрезаются до пределов схемы', () => {
    const { token } = ctx.sessions.create(userId, { ip: '1'.repeat(100), userAgent: 'u'.repeat(2000) });
    expect(String(row(token).ip)).toHaveLength(45);
    expect(String(row(token).user_agent)).toHaveLength(512);
  });
});
