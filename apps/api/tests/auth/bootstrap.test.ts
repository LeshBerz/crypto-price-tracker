import { ApiKeyAuthenticator } from '../../src/auth/api-key-authenticator.ts';
import { generateApiKey } from '../../src/auth/api-key.ts';
import { bootstrapApiKeys } from '../../src/auth/bootstrap.ts';
import type { Database } from '../../src/db/database.ts';
import { SqliteUnitOfWork } from '../../src/db/unit-of-work.ts';
import { createTestDb } from '../helpers/db.ts';
import { FakeClock } from '../helpers/fake-clock.ts';
import { createSpyLogger } from '../helpers/logger.ts';

describe('bootstrapApiKeys: ключи из env при старте (ADR 0002)', () => {
  const VIEWER = generateApiKey();
  const OPERATOR = generateApiKey();
  let db: Database;
  let uow: SqliteUnitOfWork;
  let clock: FakeClock;
  let spy: ReturnType<typeof createSpyLogger>;
  let auth: ApiKeyAuthenticator;
  const run = (keys: { viewer: string | null; operator: string | null }) =>
    bootstrapApiKeys({ keys, uow, clock, logger: spy.logger });
  const rows = () => db.prepare('SELECT name, scopes, revoked_at FROM api_keys ORDER BY id').all();

  beforeEach(() => {
    db = createTestDb();
    uow = new SqliteUnitOfWork(db);
    clock = new FakeClock();
    spy = createSpyLogger(clock);
    auth = new ApiKeyAuthenticator({ uow, clock });
  });
  afterEach(() => db.close());

  it('✅ создаёт оба ключа с ролями viewer и operator; они проходят аутентификацию', async () => {
    await expect(run({ viewer: VIEWER, operator: OPERATOR })).resolves.toEqual({
      viewer: 'created',
      operator: 'created',
    });
    expect(rows()).toEqual([
      { name: 'bootstrap-viewer', scopes: '["prices:read"]', revoked_at: null },
      {
        name: 'bootstrap-operator',
        scopes: '["prices:read","watchlist:write","ops:read","ops:write"]',
        revoked_at: null,
      },
    ]);
    expect((await auth.authenticate(VIEWER))?.scopes).toEqual(new Set(['prices:read']));
    expect((await auth.authenticate(OPERATOR))?.scopes.size).toBe(4);
  });

  it('идемпотентен: повторный старт с теми же ключами ничего не меняет', async () => {
    await run({ viewer: VIEWER, operator: OPERATOR });
    const before = rows();
    await expect(run({ viewer: VIEWER, operator: OPERATOR })).resolves.toEqual({
      viewer: 'unchanged',
      operator: 'unchanged',
    });
    expect(rows()).toEqual(before);
  });

  it('незаданный ключ пропускается', async () => {
    await expect(run({ viewer: null, operator: OPERATOR })).resolves.toEqual({ operator: 'created' });
    expect(rows()).toHaveLength(1);
  });

  it('ротация: новый ключ в env заменяет старый, старый сразу получает отказ', async () => {
    await run({ viewer: VIEWER, operator: null });
    const rotated = generateApiKey();
    await expect(run({ viewer: rotated, operator: null })).resolves.toEqual({ viewer: 'rotated' });
    await expect(auth.authenticate(VIEWER)).resolves.toBeNull();
    await expect(auth.authenticate(rotated)).resolves.not.toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('ключ, отозванный через CLI, не воскресает при рестарте; в логе предупреждение', async () => {
    await run({ viewer: VIEWER, operator: null });
    await uow.run(({ apiKeys }) => apiKeys.revoke('bootstrap-viewer', clock.now()));
    await expect(run({ viewer: VIEWER, operator: null })).resolves.toEqual({ viewer: 'revoked' });
    await expect(auth.authenticate(VIEWER)).resolves.toBeNull();
    expect(spy.entries()).toContainEqual(
      expect.objectContaining({ level: 'warn', name: 'bootstrap-viewer', outcome: 'revoked' }),
    );
  });

  it('scopes роли поменялись в коде → подтягиваются к ключу', async () => {
    await run({ viewer: null, operator: OPERATOR });
    await uow.run(async ({ apiKeys }) => {
      const key = await apiKeys.findByName('bootstrap-operator');
      await apiKeys.setScopes(key?.id ?? 0, ['prices:read']);
    });
    await expect(run({ viewer: null, operator: OPERATOR })).resolves.toEqual({ operator: 'scopes-updated' });
    expect((await auth.authenticate(OPERATOR))?.scopes.size).toBe(4);
  });

  it('сам ключ не попадает в лог', async () => {
    await run({ viewer: VIEWER, operator: OPERATOR });
    const text = JSON.stringify(spy.entries());
    expect(text).not.toContain(VIEWER);
    expect(text).not.toContain(OPERATOR.slice(4));
    expect(spy.entries()).toContainEqual(
      expect.objectContaining({ msg: 'bootstrap api key ready', outcome: 'created' }),
    );
  });
});
