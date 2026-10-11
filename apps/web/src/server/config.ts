// Конфиг web из окружения. Ошибка останавливает старт с понятным сообщением; значения секретов в нём не печатаются.
import { isPasswordHash } from './passwords';
import { LOGIN_FORMAT } from './users';

export type WebConfig = {
  databasePath: string;
  /** Первый оператор: логин и хэш пароля (не сам пароль) */
  bootstrap: { login: string; passwordHash: string } | null;
  /** Перед web стоит свой обратный прокси: можно верить X-Forwarded-For и X-Forwarded-Proto */
  trustProxy: boolean;
  /** Доступ BFF к apps/api: ключи живут только на сервере Next (ADR 0002, 0016) */
  api: ApiConfig;
};

export type ApiConfig = {
  /** Origin api без пути и завершающей косой черты */
  baseUrl: string;
  viewerKey: string;
  operatorKey: string;
  timeoutMs: number;
};

/** Тот же формат, что проверяет api: cpt_ + 32 байта в base64url */
const API_KEY_FORMAT = /^cpt_[A-Za-z0-9_-]{43}$/;
const DEFAULT_API_TIMEOUT_MS = 10_000;

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

function apiKey(env: Env, name: string): string {
  const value = env[name]?.trim() ?? '';
  if (value === '') throw new ConfigError(`${name}: обязателен — ключ api этой роли (выпуск: npm run keys:create)`);
  if (!API_KEY_FORMAT.test(value)) throw new ConfigError(`${name}: ожидается ключ вида cpt_ + 43 символа base64url`);
  return value;
}

function loadApiConfig(env: Env): ApiConfig {
  const raw = env.API_BASE_URL?.trim() || 'http://localhost:3000';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('API_BASE_URL: ожидается адрес вида http://host:port');
  }
  const bare = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '';
  if (!['http:', 'https:'].includes(url.protocol) || !bare) {
    throw new ConfigError('API_BASE_URL: только http(s)://host[:port], без пути, параметров и учётных данных');
  }
  const viewerKey = apiKey(env, 'API_VIEWER_KEY');
  const operatorKey = apiKey(env, 'API_OPERATOR_KEY');
  // Один ключ на обе роли — почти наверняка ошибка копирования: viewer получил бы права оператора
  if (viewerKey === operatorKey) throw new ConfigError('API_VIEWER_KEY и API_OPERATOR_KEY должны быть разными ключами');

  const timeoutRaw = env.API_TIMEOUT_MS?.trim() ?? '';
  const timeoutMs = timeoutRaw === '' ? DEFAULT_API_TIMEOUT_MS : Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new ConfigError('API_TIMEOUT_MS: целое число миллисекунд от 100 до 120000');
  }
  return { baseUrl: url.origin, viewerKey, operatorKey, timeoutMs };
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
    api: loadApiConfig(env),
  };
}
