import {
  API_KEY_PATTERN,
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
  hashesEqual,
  isScope,
  ROLE_SCOPES,
} from '../../src/auth/api-key.ts';

describe('формат API-ключа (ADR 0002)', () => {
  it('cpt_ + 32 случайных байта в base64url = 47 символов', () => {
    const key = generateApiKey();
    expect(key).toMatch(API_KEY_PATTERN);
    expect(key).toHaveLength(47);
    expect(generateApiKey()).not.toBe(key);
  });

  it('берёт ровно 32 байта из источника случайности', () => {
    const random = jest.fn((size: number) => Buffer.alloc(size, 0xff));
    expect(generateApiKey(random)).toBe(`cpt_${'_'.repeat(42)}8`);
    expect(random).toHaveBeenCalledWith(32);
  });

  it('префикс — первые 12 символов (как CHECK key_prefix)', () => {
    expect(apiKeyPrefix('cpt_abcdefgh_rest')).toBe('cpt_abcdefgh');
  });

  it('хэш — SHA-256 hex в нижнем регистре (тестовый вектор NIST «abc»)', () => {
    expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('роли: viewer только читает, operator получает все 4 scope', () => {
    expect(ROLE_SCOPES.viewer).toEqual(['prices:read']);
    expect(ROLE_SCOPES.operator).toEqual(['prices:read', 'watchlist:write', 'ops:read', 'ops:write']);
    expect(isScope('ops:read')).toBe(true);
    expect(isScope('admin')).toBe(false);
  });
});

describe('hashesEqual: сравнение за постоянное время', () => {
  const hash = hashApiKey('key');

  it('✅ одинаковые хэши', () => {
    expect(hashesEqual(hash, hashApiKey('key'))).toBe(true);
  });

  it('❌ разные хэши той же длины', () => {
    expect(hashesEqual(hash, hashApiKey('other'))).toBe(false);
  });

  it('❌ разная длина — false, а не исключение timingSafeEqual', () => {
    expect(hashesEqual(hash, hash.slice(0, 62))).toBe(false);
    expect(hashesEqual(hash, '')).toBe(false);
  });
});
