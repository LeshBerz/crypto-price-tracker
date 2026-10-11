import { DEFAULT_PARAMS, hashPassword, isAcceptablePassword, isPasswordHash, verifyPassword } from '@/server/passwords';
import { FAST_PARAMS } from './helpers';

const SALT = 'A'.repeat(22);
const KEY = 'A'.repeat(43);

describe('пароли: scrypt', () => {
  it('✅ хэш содержит параметры и не содержит пароль', async () => {
    const hash = await hashPassword('correct horse battery', FAST_PARAMS);
    expect(hash).toMatch(/^scrypt\$10\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toContain('correct');
    expect(isPasswordHash(hash)).toBe(true);
  });

  it('✅ верный пароль подходит, неверный — нет', async () => {
    const hash = await hashPassword('correct horse battery', FAST_PARAMS);
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
    await expect(verifyPassword('correct horse batterz', hash)).resolves.toBe(false);
  });

  it('✅ соль случайная: два хэша одного пароля различаются, оба подходят', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password 123', FAST_PARAMS),
      hashPassword('same password 123', FAST_PARAMS),
    ]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('same password 123', a)).resolves.toBe(true);
    await expect(verifyPassword('same password 123', b)).resolves.toBe(true);
  });

  it('✅ параметры по умолчанию — минимум OWASP (N = 2^17, r = 8, p = 1) и проходят по памяти', async () => {
    expect(DEFAULT_PARAMS).toEqual({ logN: 17, r: 8, p: 1 });
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$17$8$1$')).toBe(true);
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
  });

  it.each([
    ['пустая строка', ''],
    ['открытый пароль', 'correct horse battery'],
    ['другой алгоритм', `bcrypt$10$8$1$${SALT}$${KEY}`],
    ['короткая соль', `scrypt$10$8$1$AAAA$${KEY}`],
    ['N за верхней границей', `scrypt$31$8$1$${SALT}$${KEY}`],
    ['N ниже нижней границы', `scrypt$1$8$1$${SALT}$${KEY}`],
    ['r за границей', `scrypt$10$64$1$${SALT}$${KEY}`],
    ['p равно нулю', `scrypt$10$8$0$${SALT}$${KEY}`],
  ])('❌ некорректный хэш (%s) не подходит ни к какому паролю и не считается', async (_name, stored) => {
    expect(isPasswordHash(stored)).toBe(false);
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(false);
  });

  it('политика: длина от 12 до 128 символов, состав не важен', () => {
    expect(isAcceptablePassword('a'.repeat(11))).toBe(false);
    expect(isAcceptablePassword('a'.repeat(12))).toBe(true);
    expect(isAcceptablePassword('a'.repeat(128))).toBe(true);
    expect(isAcceptablePassword('a'.repeat(129))).toBe(false);
  });
});
