import { API_KEY_PATTERN } from '../src/auth/api-key.ts';
import { ConfigError, databasePathFrom, loadConfig, MIN_SYNC_INTERVAL_MS } from '../src/config.ts';

const VIEWER = 'cpt_' + 'v'.repeat(43);
const OPERATOR = 'cpt_' + 'o'.repeat(43);
const CMC_KEY = 'b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c';

function issuesOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error('ожидалась ConfigError');
}

describe('loadConfig', () => {
  it('минимальный env: обязателен только CMC_API_KEY, остальное — значения по умолчанию', () => {
    expect(loadConfig({ CMC_API_KEY: CMC_KEY })).toEqual({
      port: 3000,
      logLevel: 'info',
      databasePath: './data/cpt.db',
      cmc: { apiKey: CMC_KEY, baseUrl: 'https://pro-api.coinmarketcap.com', timeoutMs: 10_000 },
      syncIntervalMs: 300_000,
      bootstrapKeys: { viewer: null, operator: null },
    });
  });

  it('читает все переменные; пустые и пробельные значения = не заданы; хвостовой слеш URL убирается', () => {
    const config = loadConfig({
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATABASE_PATH: '/var/lib/cpt/cpt.db',
      CMC_API_KEY: ` ${CMC_KEY} `,
      CMC_BASE_URL: 'http://cmc-stub:4000/',
      CMC_TIMEOUT_MS: '  ',
      SYNC_INTERVAL_MS: String(MIN_SYNC_INTERVAL_MS),
      BOOTSTRAP_VIEWER_KEY: VIEWER,
      BOOTSTRAP_OPERATOR_KEY: OPERATOR,
    });
    expect(config).toEqual({
      port: 8080,
      logLevel: 'debug',
      databasePath: '/var/lib/cpt/cpt.db',
      cmc: { apiKey: CMC_KEY, baseUrl: 'http://cmc-stub:4000', timeoutMs: 10_000 },
      syncIntervalMs: MIN_SYNC_INTERVAL_MS,
      bootstrapKeys: { viewer: VIEWER, operator: OPERATOR },
    });
  });

  it('SYNC_INTERVAL_MS меньше 180000 — ошибка старта (квота CMC, ADR 0007)', () => {
    expect(issuesOf({ CMC_API_KEY: CMC_KEY, SYNC_INTERVAL_MS: '179999' })).toEqual([
      'SYNC_INTERVAL_MS: ожидается целое число от 180000 до 86400000',
    ]);
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['PORT', '-1'],
    ['PORT', '80.5'],
    ['CMC_TIMEOUT_MS', '50'],
    ['SYNC_INTERVAL_MS', '3e5'],
  ])('%s=%s — не целое в допустимом диапазоне', (name, value) => {
    expect(issuesOf({ CMC_API_KEY: CMC_KEY, [name]: value })).toEqual([
      expect.stringMatching(new RegExp(`^${name}: ожидается целое число`)),
    ]);
  });

  it('собирает все ошибки сразу', () => {
    const issues = issuesOf({
      LOG_LEVEL: 'verbose',
      CMC_BASE_URL: 'ftp://example.com',
      PORT: 'x',
      BOOTSTRAP_VIEWER_KEY: 'cpt_short',
    });
    expect(issues).toEqual([
      expect.stringMatching(/^PORT:/),
      'LOG_LEVEL: ожидается одно из debug, info, warn, error',
      expect.stringMatching(/^CMC_API_KEY: обязательна/),
      'CMC_BASE_URL: ожидается URL со схемой http или https',
      expect.stringMatching(/^BOOTSTRAP_VIEWER_KEY: ожидается ключ вида cpt_/),
    ]);
  });

  it('CMC_BASE_URL, который не парсится как URL, — ошибка', () => {
    expect(issuesOf({ CMC_API_KEY: CMC_KEY, CMC_BASE_URL: 'not a url' })).toHaveLength(1);
  });

  it('одинаковые ключи viewer и operator — ошибка', () => {
    expect(issuesOf({ CMC_API_KEY: CMC_KEY, BOOTSTRAP_VIEWER_KEY: VIEWER, BOOTSTRAP_OPERATOR_KEY: VIEWER })).toEqual([
      expect.stringMatching(/совпадают/),
    ]);
  });

  it('значения секретов не попадают в текст ошибки (C4)', () => {
    const leaked = 'cpt_leaked-secret-value';
    let message = '';
    try {
      loadConfig({ CMC_API_KEY: CMC_KEY, BOOTSTRAP_OPERATOR_KEY: leaked, PORT: CMC_KEY });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Некорректная конфигурация:\n {2}- PORT/);
    expect(message).not.toContain(leaked);
    expect(message).not.toContain(CMC_KEY);
  });

  it('формат ключа ADR 0002: cpt_ + 43 символа base64url', () => {
    expect(API_KEY_PATTERN.test(VIEWER)).toBe(true);
    expect(API_KEY_PATTERN.test(`${VIEWER}x`)).toBe(false);
    expect(API_KEY_PATTERN.test('cpt_' + '+'.repeat(43))).toBe(false);
  });

  it('databasePathFrom: путь к БД без остального конфига (для CLI)', () => {
    expect(databasePathFrom({})).toBe('./data/cpt.db');
    expect(databasePathFrom({ DATABASE_PATH: '  ' })).toBe('./data/cpt.db');
    expect(databasePathFrom({ DATABASE_PATH: ' /data/x.db ' })).toBe('/data/x.db');
  });
});
