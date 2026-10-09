// SqliteApiKeyRepository на настоящей SQLite с миграциями (ADR 0009: БД не мокаем).
import type { NewApiKey } from '../../src/auth/api-key-repository.ts';
import type { Database } from '../../src/db/database.ts';
import { SqliteApiKeyRepository } from '../../src/db/repositories/api-keys.ts';
import { SqliteUnitOfWork } from '../../src/db/unit-of-work.ts';
import { createTestDb, T0 } from '../helpers/db.ts';

const NEW_KEY: NewApiKey = {
  name: 'web-operator',
  keyPrefix: 'cpt_abcdefgh',
  keyHash: 'a'.repeat(64),
  scopes: ['prices:read', 'watchlist:write'],
  createdAt: T0,
};

describe('SqliteApiKeyRepository', () => {
  let db: Database;
  let uow: SqliteUnitOfWork;

  beforeEach(() => {
    db = createTestDb();
    uow = new SqliteUnitOfWork(db);
  });
  afterEach(() => db.close());

  it('create возвращает запись, findByPrefix и findByName находят её', async () => {
    const created = await uow.run(({ apiKeys }) => apiKeys.create(NEW_KEY));
    expect(created).toEqual({ id: 1, ...NEW_KEY, lastUsedAt: null, revokedAt: null });
    await uow.run(async ({ apiKeys }) => {
      expect(await apiKeys.findByPrefix('cpt_abcdefgh')).toEqual(created);
      expect(await apiKeys.findByName('web-operator')).toEqual(created);
      expect(await apiKeys.findByPrefix('cpt_zzzzzzzz')).toBeNull();
      expect(await apiKeys.findByName('nope')).toBeNull();
    });
  });

  it('scopes хранятся JSON-массивом (CHECK json_type = array)', async () => {
    await uow.run(({ apiKeys }) => apiKeys.create({ ...NEW_KEY, scopes: [] }));
    expect(db.prepare('SELECT scopes FROM api_keys').get()).toEqual({ scopes: '[]' });
  });

  it('touch пишет last_used_at', async () => {
    const { id } = await uow.run(({ apiKeys }) => apiKeys.create(NEW_KEY));
    await uow.run(({ apiKeys }) => apiKeys.touch(id, T0 + 5000));
    expect((await uow.run(({ apiKeys }) => apiKeys.findByName(NEW_KEY.name)))?.lastUsedAt).toBe(T0 + 5000);
  });

  it('revoke: true один раз, повторно и для неизвестного имени — false', async () => {
    await uow.run(({ apiKeys }) => apiKeys.create(NEW_KEY));
    await uow.run(async ({ apiKeys }) => {
      expect(await apiKeys.revoke(NEW_KEY.name, T0 + 1)).toBe(true);
      expect(await apiKeys.revoke(NEW_KEY.name, T0 + 2)).toBe(false);
      expect(await apiKeys.revoke('nope', T0 + 2)).toBe(false);
      expect((await apiKeys.findByName(NEW_KEY.name))?.revokedAt).toBe(T0 + 1);
    });
  });

  it('replaceSecret: новый префикс и хэш, отзыв и last_used_at сброшены', async () => {
    const { id } = await uow.run(({ apiKeys }) => apiKeys.create(NEW_KEY));
    await uow.run(async ({ apiKeys }) => {
      await apiKeys.touch(id, T0 + 1);
      await apiKeys.revoke(NEW_KEY.name, T0 + 2);
      await apiKeys.replaceSecret(id, {
        keyPrefix: 'cpt_newnewne',
        keyHash: 'b'.repeat(64),
        scopes: [],
        createdAt: T0 + 3,
      });
    });
    const key = await uow.run(({ apiKeys }) => apiKeys.findByName(NEW_KEY.name));
    expect(key).toEqual({
      id,
      name: NEW_KEY.name,
      keyPrefix: 'cpt_newnewne',
      keyHash: 'b'.repeat(64),
      scopes: [],
      createdAt: T0 + 3,
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it('setScopes меняет только scopes', async () => {
    const { id } = await uow.run(({ apiKeys }) => apiKeys.create(NEW_KEY));
    await uow.run(({ apiKeys }) => apiKeys.setScopes(id, ['ops:read']));
    expect((await uow.run(({ apiKeys }) => apiKeys.findByName(NEW_KEY.name)))?.scopes).toEqual(['ops:read']);
  });

  it('❌ дубль имени или префикса отклоняет UNIQUE в схеме', async () => {
    await uow.run(({ apiKeys }) => apiKeys.create(NEW_KEY));
    await expect(
      uow.run(({ apiKeys }) => apiKeys.create({ ...NEW_KEY, keyHash: 'c'.repeat(64), keyPrefix: 'cpt_other123' })),
    ).rejects.toThrow(/UNIQUE constraint failed: api_keys.name/);
    await expect(
      uow.run(({ apiKeys }) => apiKeys.create({ ...NEW_KEY, name: 'other', keyHash: 'c'.repeat(64) })),
    ).rejects.toThrow(/UNIQUE constraint failed: api_keys.key_prefix/);
  });

  it('❌ вызов вне UnitOfWork.run — ошибка, а не запрос мимо транзакции', async () => {
    const repo = new SqliteApiKeyRepository(db);
    const message = /вне UnitOfWork.run/;
    await expect(repo.findByPrefix('cpt_abcdefgh')).rejects.toThrow(message);
    await expect(repo.findByName('x')).rejects.toThrow(message);
    await expect(repo.create(NEW_KEY)).rejects.toThrow(message);
    await expect(repo.replaceSecret(1, NEW_KEY)).rejects.toThrow(message);
    await expect(repo.setScopes(1, [])).rejects.toThrow(message);
    await expect(repo.touch(1, T0)).rejects.toThrow(message);
    await expect(repo.revoke('x', T0)).rejects.toThrow(message);
  });
});
