// Формат API-ключа и его хэш (ADR 0002). Чистые функции без БД: их используют аутентификатор, bootstrap и CLI.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Формат ключа: cpt_ + 32 случайных байта в base64url (43 символа) */
export const API_KEY_PATTERN = /^cpt_[A-Za-z0-9_-]{43}$/;
/** Длина key_prefix в api_keys (CHECK в 0001_core.sql): cpt_ + 8 символов. По нему ищем ключ и узнаём его в CLI */
export const API_KEY_PREFIX_LENGTH = 12;

export const SCOPES = ['prices:read', 'watchlist:write', 'ops:read', 'ops:write'] as const;
export type Scope = (typeof SCOPES)[number];

/** Роли из брифа (ADR 0002): viewer смотрит, operator меняет. Ключ оператора получает все scope (поправка ADR 0014) */
export const ROLE_SCOPES = {
  viewer: ['prices:read'],
  operator: [...SCOPES],
} as const satisfies Record<string, readonly Scope[]>;
export type Role = keyof typeof ROLE_SCOPES;

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** 256 бит случайности: перебор бессмысленен, поэтому хватает быстрого SHA-256 (не bcrypt) */
export function generateApiKey(random: (size: number) => Buffer = randomBytes): string {
  return `cpt_${random(32).toString('base64url')}`;
}

export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX_LENGTH);
}

/** SHA-256 в hex (64 символа, нижний регистр — как требует CHECK key_hash) */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Сравнение хэшей за постоянное время: обычное === останавливается на первом несовпавшем символе,
 * и по времени ответа можно подбирать хэш побайтно (timing attack).
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  // timingSafeEqual бросает на буферах разной длины. Длина хэша не секрет: у SHA-256 она всегда 32 байта
  return left.length === right.length && timingSafeEqual(left, right);
}
