// Конфигурация из переменных окружения (D-4, C4, ADR 0015 §5). Читается один раз при старте:
// дальше всё приложение получает типизированный объект, а не лезет в process.env.
// Список переменных с комментариями — .env.example в корне репозитория.
import { API_KEY_PATTERN } from './auth/api-key.ts';
import { LOG_LEVELS, type LogLevel } from './common/logger.ts';

export type Config = {
  port: number;
  logLevel: LogLevel;
  databasePath: string;
  cmc: { apiKey: string; baseUrl: string; timeoutMs: number };
  syncIntervalMs: number;
  /** Ключи из env, которые при старте записываются в БД хэшами (ADR 0002); null — не задан */
  bootstrapKeys: { viewer: string | null; operator: string | null };
};

/** Минимальный интервал: чаще квота CMC Basic не выдержит (ADR 0007, ~2,9 мин — теоретический предел) */
export const MIN_SYNC_INTERVAL_MS = 180_000;

export class ConfigError extends Error {
  override name = 'ConfigError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Некорректная конфигурация:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.issues = issues;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Собирает и проверяет конфиг. Все ошибки сразу, а не первая: исправить .env за один заход.
 * Значения переменных в сообщения не попадают никогда — так секрет не утечёт в лог, даже если
 * его по ошибке положили не в ту переменную.
 */
export function loadConfig(env: Env): Config {
  const issues: string[] = [];
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === '' ? undefined : value;
  };

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      issues.push(`${name}: ожидается целое число от ${min} до ${max}`);
      return fallback;
    }
    return Number(raw);
  };

  const port = integer('PORT', 3000, 0, 65_535);
  const timeoutMs = integer('CMC_TIMEOUT_MS', 10_000, 100, 60_000);
  const syncIntervalMs = integer('SYNC_INTERVAL_MS', 300_000, MIN_SYNC_INTERVAL_MS, 86_400_000);

  const level = read('LOG_LEVEL') ?? 'info';
  const logLevel = LOG_LEVELS.find((l) => l === level);
  if (!logLevel) issues.push(`LOG_LEVEL: ожидается одно из ${LOG_LEVELS.join(', ')}`);

  const apiKey = read('CMC_API_KEY');
  if (!apiKey) issues.push('CMC_API_KEY: обязательна (ключ CoinMarketCap; для стаба подойдёт любое значение)');

  const baseUrl = read('CMC_BASE_URL') ?? 'https://pro-api.coinmarketcap.com';
  if (!isHttpUrl(baseUrl)) issues.push('CMC_BASE_URL: ожидается URL со схемой http или https');

  const bootstrapKey = (name: string): string | null => {
    const value = read(name);
    if (value === undefined) return null;
    if (!API_KEY_PATTERN.test(value)) {
      issues.push(`${name}: ожидается ключ вида cpt_ + 43 символа base64url (выпуск: npm run keys:create)`);
    }
    return value;
  };
  const viewer = bootstrapKey('BOOTSTRAP_VIEWER_KEY');
  const operator = bootstrapKey('BOOTSTRAP_OPERATOR_KEY');
  if (viewer !== null && viewer === operator) {
    issues.push('BOOTSTRAP_VIEWER_KEY и BOOTSTRAP_OPERATOR_KEY совпадают: у ролей должны быть разные ключи');
  }

  if (issues.length > 0) throw new ConfigError(issues);

  return {
    port,
    logLevel: logLevel as LogLevel,
    databasePath: databasePathFrom(env),
    cmc: { apiKey: apiKey as string, baseUrl: baseUrl.replace(/\/+$/, ''), timeoutMs },
    syncIntervalMs,
    bootstrapKeys: { viewer, operator },
  };
}

/** Отдельно от loadConfig: CLI нужна только БД, а не ключ CMC и остальной конфиг сервера */
export function databasePathFrom(env: Env): string {
  return env['DATABASE_PATH']?.trim() || './data/cpt.db';
}

function isHttpUrl(value: string): boolean {
  return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol);
}
