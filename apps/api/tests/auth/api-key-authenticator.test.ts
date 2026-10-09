import { ApiKeyAuthenticator, TOUCH_INTERVAL_MS } from '../../src/auth/api-key-authenticator.ts';
import { hashApiKey } from '../../src/auth/api-key.ts';
import type { Database } from '../../src/db/database.ts';
import { SqliteUnitOfWork } from '../../src/db/unit-of-work.ts';
import { seedTestKeys, TOKENS } from '../helpers/auth.ts';
import { createTestDb, T0 } from '../helpers/db.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

describe('ApiKeyAuthenticator (ADR 0002)', () => {
  let db: Database;
  let uow: SqliteUnitOfWork;
  let clock: FakeClock;
  let auth: ApiKeyAuthenticator;
  const lastUsedAt = (name: string) =>
    (db.prepare('SELECT last_used_at FROM api_keys WHERE name = ?').get(name) as { last_used_at: number | null })
      .last_used_at;

  beforeEach(async () => {
    db = createTestDb();
    uow = new SqliteUnitOfWork(db);
    await seedTestKeys(uow);
    clock = new FakeClock();
    auth = new ApiKeyAuthenticator({ uow, clock });
  });
  afterEach(() => db.close());

  it('✅ действующий ключ → Principal с id ключа и его scopes', async () => {
    await expect(auth.authenticate(TOKENS.viewer)).resolves.toEqual({ keyId: 1, scopes: new Set(['prices:read']) });
    const operator = await auth.authenticate(TOKENS.operator);
    expect([...(operator?.scopes ?? [])]).toEqual(['prices:read', 'watchlist:write', 'ops:read', 'ops:write']);
  });

  it('❌ отозванный ключ → null', async () => {
    await expect(auth.authenticate(TOKENS.revoked)).resolves.toBeNull();
  });

  it('❌ неизвестный ключ правильного формата → null', async () => {
    await expect(auth.authenticate(`cpt_${'z'.repeat(43)}`)).resolves.toBeNull();
  });

  it('❌ префикс совпал, а остаток ключа другой → null (решает хэш, а не префикс)', async () => {
    const forged = `${TOKENS.viewer.slice(0, 12)}${'Q'.repeat(35)}`;
    expect(hashApiKey(forged)).not.toBe(hashApiKey(TOKENS.viewer));
    await expect(auth.authenticate(forged)).resolves.toBeNull();
  });

  it('❌ чужой формат отсекается без запроса в БД', async () => {
    const run = jest.spyOn(uow, 'run');
    for (const token of ['viewer-token', `cpt_${'a'.repeat(42)}`, `cpt_${'a'.repeat(44)}`, `${TOKENS.viewer}=`]) {
      await expect(auth.authenticate(token)).resolves.toBeNull();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('last_used_at: пишется при первом запросе, затем не чаще раза в 60 с', async () => {
    expect(lastUsedAt('viewer')).toBeNull();
    await auth.authenticate(TOKENS.viewer);
    expect(lastUsedAt('viewer')).toBe(T0);

    await clock.advance(TOUCH_INTERVAL_MS - 1);
    await auth.authenticate(TOKENS.viewer);
    expect(lastUsedAt('viewer')).toBe(T0);

    await clock.advance(1);
    await auth.authenticate(TOKENS.viewer);
    expect(lastUsedAt('viewer')).toBe(T0 + TOUCH_INTERVAL_MS);
  });

  it('отозванный ключ не трогает last_used_at', async () => {
    await auth.authenticate(TOKENS.revoked);
    expect(lastUsedAt('revoked')).toBeNull();
  });
});
