// Конфиг web из окружения. Ошибка останавливает старт с понятным сообщением; значения секретов в нём не печатаются.
import { isPasswordHash } from './passwords';
import { LOGIN_FORMAT } from './users';

export type WebConfig = {
  databasePath: string;
  /** Первый оператор: логин и хэш пароля (не сам пароль) */
  bootstrap: { login: string; passwordHash: string } | null;
  /** Перед web стоит свой обратный прокси: можно верить X-Forwarded-For и X-Forwarded-Proto */
  trustProxy: boolean;
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

function flag(env: Env, name: string): boolean {
  const value = env[name]?.trim().toLowerCase() ?? '';
  if (value === '' || value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  throw new ConfigError(`${name}: ожидается true или false`);
}

export function loadConfig(env: Env = process.env): WebConfig {
  const login = env.WEB_BOOTSTRAP_LOGIN?.trim() ?? '';
  const passwordHash = env.WEB_BOOTSTRAP_PASSWORD_HASH?.trim() ?? '';
  if ((login === '') !== (passwordHash === '')) {
    throw new ConfigError('WEB_BOOTSTRAP_LOGIN и WEB_BOOTSTRAP_PASSWORD_HASH задаются только вместе');
  }
  if (login !== '' && !LOGIN_FORMAT.test(login)) {
    throw new ConfigError('WEB_BOOTSTRAP_LOGIN: 3–32 символа из набора a-z, 0-9, точка, дефис, подчёркивание');
  }
  if (passwordHash !== '' && !isPasswordHash(passwordHash)) {
    throw new ConfigError('WEB_BOOTSTRAP_PASSWORD_HASH: ожидается хэш из `npm run hash-password -w @cpt/web`');
  }
  return {
    databasePath: env.WEB_DATABASE_PATH?.trim() || './data/web.db',
    bootstrap: login === '' ? null : { login, passwordHash },
    trustProxy: flag(env, 'WEB_TRUST_PROXY'),
  };
}
