// Bootstrap API-ключей из env при старте (ADR 0002): `docker compose up` поднимает сервис с готовыми ключами
// для web без ручного шага. Идемпотентно: env — желаемое состояние, БД к нему подтягивается.
import type { Clock } from '../common/clock.ts';
import type { Logger } from '../common/logger.ts';
import type { UnitOfWork } from '../unit-of-work.ts';
import { apiKeyPrefix, hashApiKey, ROLE_SCOPES, type Role } from './api-key.ts';

/** Имена bootstrap-ключей зарезервированы: CLI не даёт создать ключ с таким префиксом */
export const BOOTSTRAP_NAME_PREFIX = 'bootstrap-';

export type BootstrapOutcome = 'created' | 'rotated' | 'scopes-updated' | 'unchanged' | 'revoked';

export async function bootstrapApiKeys(deps: {
  keys: Readonly<Record<Role, string | null>>;
  uow: UnitOfWork;
  clock: Clock;
  logger: Logger;
}): Promise<Partial<Record<Role, BootstrapOutcome>>> {
  const outcomes: Partial<Record<Role, BootstrapOutcome>> = {};
  for (const role of Object.keys(ROLE_SCOPES) as Role[]) {
    const key = deps.keys[role];
    if (key === null) continue;
    const name = `${BOOTSTRAP_NAME_PREFIX}${role}`;
    const scopes = [...ROLE_SCOPES[role]];
    const secret = { keyPrefix: apiKeyPrefix(key), keyHash: hashApiKey(key), scopes, createdAt: deps.clock.now() };

    const outcome = await deps.uow.run(async ({ apiKeys }): Promise<BootstrapOutcome> => {
      const existing = await apiKeys.findByName(name);
      if (existing === null) {
        await apiKeys.create({ name, ...secret });
        return 'created';
      }
      // Хэши не секретны друг от друга и не зависят от запроса: обычное сравнение здесь безопасно
      if (existing.keyHash !== secret.keyHash) {
        // Ключ в env сменили (ротация): новый секрет под тем же именем, старый ключ сразу перестаёт работать
        await apiKeys.replaceSecret(existing.id, secret);
        return 'rotated';
      }
      // Тот же ключ, но его отозвали через CLI — решение оператора важнее env, не воскрешаем
      if (existing.revokedAt !== null) return 'revoked';
      if (existing.scopes.join(' ') !== scopes.join(' ')) {
        await apiKeys.setScopes(existing.id, scopes);
        return 'scopes-updated';
      }
      return 'unchanged';
    });

    outcomes[role] = outcome;
    const fields = { name, outcome, scopes };
    if (outcome === 'revoked') deps.logger.warn('bootstrap api key is revoked, requests with it get 401', fields);
    else deps.logger.info('bootstrap api key ready', fields);
  }
  return outcomes;
}
