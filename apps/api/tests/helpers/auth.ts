// Фейк порта Authenticator: настоящая проверка ключей по БД — в B8, а HTTP-тестам нужны роли уже сейчас.
import type { Authenticator, Principal } from '../../src/http/auth.ts';

const ALL_SCOPES = ['prices:read', 'watchlist:write', 'ops:read', 'ops:write'];
/** Роли из ADR 0002 плюс «урезанный» ключ для негативных тестов 403 */
export const TOKENS = {
  viewer: 'viewer-token',
  operator: 'operator-token',
  opsWriteOnly: 'ops-write-token',
} as const;

const PRINCIPALS: Record<string, Principal> = {
  [TOKENS.viewer]: { keyId: 1, scopes: new Set(['prices:read']) },
  [TOKENS.operator]: { keyId: 2, scopes: new Set(ALL_SCOPES) },
  [TOKENS.opsWriteOnly]: { keyId: 3, scopes: new Set(['ops:write']) },
};

export const fakeAuthenticator: Authenticator = {
  authenticate: (token) => Promise.resolve(PRINCIPALS[token] ?? null),
};

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
