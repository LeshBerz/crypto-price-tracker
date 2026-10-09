// Тестовые API-ключи. HTTP-тесты приложения проверяют их настоящим ApiKeyAuthenticator по SQLite (seedTestKeys),
// а тесты самого роутера — фейком порта, без БД.
import { apiKeyPrefix, hashApiKey, ROLE_SCOPES } from '../../src/auth/api-key.ts';
import type { Authenticator, Principal } from '../../src/http/auth.ts';
import type { UnitOfWork } from '../../src/unit-of-work.ts';
import { T0 } from './db.ts';

/** Ключи формата cpt_ + 43 символа; первые 12 символов (префикс) у всех разные */
const key = (label: string) => `cpt_${label.padEnd(43, 'x')}`;

/** Роли из ADR 0002 плюс ключи для негативных тестов 401/403 */
export const TOKENS = {
  viewer: key('test-viewer'),
  operator: key('test-operator'),
  opsWriteOnly: key('test-opswrite'),
  noScopes: key('test-noscopes'),
  revoked: key('test-revoked'),
} as const;

const SCOPES_OF: Record<keyof typeof TOKENS, string[]> = {
  viewer: [...ROLE_SCOPES.viewer],
  operator: [...ROLE_SCOPES.operator],
  opsWriteOnly: ['ops:write'],
  noScopes: [],
  revoked: [...ROLE_SCOPES.operator],
};

/** Записывает TOKENS в БД; id ключей идут в порядке TOKENS начиная с 1 */
export async function seedTestKeys(uow: UnitOfWork): Promise<void> {
  await uow.run(async ({ apiKeys }) => {
    for (const [name, token] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
      await apiKeys.create({
        name,
        keyPrefix: apiKeyPrefix(token),
        keyHash: hashApiKey(token),
        scopes: SCOPES_OF[name],
        createdAt: T0,
      });
    }
    await apiKeys.revoke('revoked', T0);
  });
}

const PRINCIPALS: Record<string, Principal> = Object.fromEntries(
  (Object.keys(TOKENS) as (keyof typeof TOKENS)[])
    .filter((name) => name !== 'revoked')
    .map((name, index) => [TOKENS[name], { keyId: index + 1, scopes: new Set(SCOPES_OF[name]) }]),
);

export const fakeAuthenticator: Authenticator = {
  authenticate: (token) => Promise.resolve(PRINCIPALS[token] ?? null),
};

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
