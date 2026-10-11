// Хэширование паролей (ADR 0016): scrypt из node:crypto, параметры записаны в строке хэша.
// Файл без относительных импортов: его запускает и Next, и `node scripts/hash-password.ts`.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export type ScryptParams = { logN: number; r: number; p: number };

/** Минимум OWASP Password Storage: N = 2^17, r = 8, p = 1 — около 285 мс на хэш */
export const DEFAULT_PARAMS: ScryptParams = { logN: 17, r: 8, p: 1 };

/** NIST SP 800-63B: длина важнее состава, требований «цифра + спецсимвол» нет */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const HASH_FORMAT = /^scrypt\$(\d{1,2})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

/**
 * Только асинхронный scrypt: расчёт идёт в пуле потоков libuv. scryptSync блокировал бы Event Loop
 * на сотни миллисекунд при каждом входе.
 */
function derive(password: string, salt: Buffer, { logN, r, p }: ScryptParams): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    // scrypt требует 128 * N * r байт; предел по умолчанию (32 МБ) меньше, чем нужно для N = 2^17
    scrypt(password, salt, KEY_BYTES, { N, r, p, maxmem: 256 * N * r }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Формат `scrypt$logN$r$p$salt$hash`: параметры можно усилить позже без миграции старых хэшей */
export async function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, params);
  return `scrypt$${params.logN}$${params.r}$${params.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

type ParsedHash = { params: ScryptParams; salt: Buffer; key: Buffer };

function parseHash(stored: string): ParsedHash | null {
  const match = HASH_FORMAT.exec(stored);
  if (!match) return null;
  const params = { logN: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
  // Границы защищают от строки, которая заставила бы сервер выделить гигабайты памяти
  if (params.logN < 10 || params.logN > 20 || params.r < 1 || params.r > 16 || params.p < 1 || params.p > 4) {
    return null;
  }
  return {
    params,
    salt: Buffer.from(match[4] as string, 'base64url'),
    key: Buffer.from(match[5] as string, 'base64url'),
  };
}

export function isPasswordHash(text: string): boolean {
  return parseHash(text) !== null;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.params);
  return timingSafeEqual(key, parsed.key);
}

export function isAcceptablePassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}
