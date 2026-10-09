// Адаптер порта Authenticator (http/auth.ts): проверка Bearer API key по БД (ADR 0002).
// Аналог в Nest — PassportStrategy с validate(), только без passport (C7).
import type { Clock } from '../common/clock.ts';
import type { Authenticator, Principal } from '../http/auth.ts';
import type { UnitOfWork } from '../unit-of-work.ts';
import { API_KEY_PATTERN, apiKeyPrefix, hashApiKey, hashesEqual } from './api-key.ts';

/** last_used_at пишем не чаще раза в минуту: иначе каждый GET превращается в запись в SQLite (ADR 0013 №14) */
export const TOUCH_INTERVAL_MS = 60_000;

export class ApiKeyAuthenticator implements Authenticator {
  private readonly uow: UnitOfWork;
  private readonly clock: Clock;

  constructor(deps: { uow: UnitOfWork; clock: Clock }) {
    this.uow = deps.uow;
    this.clock = deps.clock;
  }

  async authenticate(token: string): Promise<Principal | null> {
    // Чужой формат отсекаем без похода в БД
    if (!API_KEY_PATTERN.test(token)) return null;
    const hash = hashApiKey(token);
    return this.uow.run(async ({ apiKeys }) => {
      const key = await apiKeys.findByPrefix(apiKeyPrefix(token));
      if (key === null || !hashesEqual(key.keyHash, hash) || key.revokedAt !== null) return null;
      const now = this.clock.now();
      if (key.lastUsedAt === null || now - key.lastUsedAt >= TOUCH_INTERVAL_MS) await apiKeys.touch(key.id, now);
      return { keyId: key.id, scopes: new Set(key.scopes) };
    });
  }
}
