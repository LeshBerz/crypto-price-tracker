import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig } from '@/server/config';
import { createServices } from '@/server/container';
import { migrate, MIGRATIONS, openDatabase, type Database } from '@/server/db';
import { hashPassword } from '@/server/passwords';
import { FAST_PARAMS, START, TEST_API } from './helpers';

const HASH = `scrypt$10$8$1$${'A'.repeat(22)}$${'A'.repeat(43)}`;
const TOKEN_HASH = 'a'.repeat(64);
const VIEWER_KEY = TEST_API.viewerKey;
const OPERATOR_KEY = TEST_API.operatorKey;
/** Минимум окружения, с которым web стартует: ключи api обеих ролей */
const API_ENV = { API_VIEWER_KEY: VIEWER_KEY, API_OPERATOR_KEY: OPERATOR_KEY };

function seeded(): Database {
  const db = openDatabase(':memory:');
  migrate(db, START);
  db.prepare(
    `INSERT INTO users (id, login, password_hash, role, created_at, updated_at, password_changed_at)
     VALUES (1, 'alice', ?, 'operator', ?, ?, ?)`,
  ).run(HASH, START, START, START);
  return db;
}

describe('миграции web.db', () => {
  it('✅ применяются один раз; повторный запуск ничего не делает', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db, START)).toEqual([1]);
    expect(migrate(db, START + 1)).toEqual([]);
    expect(db.prepare('SELECT version, name, applied_at FROM schema_migrations').all()).toEqual([
      { version: 1, name: 'auth', applied_at: START },
    ]);
  });

  it('❌ ошибка в миграции откатывает её целиком и останавливает старт', () => {
    const db = openDatabase(':memory:');
    const broken = [{ version: 1, name: 'broken', sql: 'CREATE TABLE a (id INTEGER); CREATE TABLE a (id INTEGER);' }];
    expect(() => migrate(db, START, broken)).toThrow('web migration 1_broken failed');
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'a'").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 0 });
  });

  it('✅ текст миграции совпадает с проверенным DDL из документации', () => {
    const documented = readFileSync(join(__dirname, '../../../docs/project/schema/web_0001_auth.sql'), 'utf8');
    expect(MIGRATIONS[0]?.sql).toBe(documented.replace(/\r\n/g, '\n'));
  });
});

describe('ограничения схемы', () => {
  const insertUser = (db: Database, login: string, hash: string, role: string) =>
    db
      .prepare(
        `INSERT INTO users (login, password_hash, role, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(login, hash, role, START, START, START);

  it.each([
    ['логин с заглавными буквами', 'Alice2', HASH, 'viewer'],
    ['логин короче 3 символов', 'ab', HASH, 'viewer'],
    ['логин с пробелом', 'al ice', HASH, 'viewer'],
    ['неизвестная роль', 'carol', HASH, 'admin'],
    ['пароль в открытом виде', 'carol', 'correct horse battery', 'viewer'],
    ['повтор логина', 'alice', HASH, 'viewer'],
  ])('❌ пользователь: %s', (_name, login, hash, role) => {
    expect(() => insertUser(seeded(), login, hash, role)).toThrow();
  });

  const insertSession = (db: Database, columns: Record<string, unknown> = {}) => {
    const row = {
      token_hash: TOKEN_HASH,
      user_id: 1,
      created_at: START,
      last_seen_at: START,
      idle_expires_at: START + 1,
      absolute_expires_at: START + 2,
      revoked_at: null,
      revoke_reason: null,
      ...columns,
    };
    const names = Object.keys(row);
    db.prepare(`INSERT INTO sessions (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(
      ...(Object.values(row) as (string | number | null)[]),
    );
  };

  it('✅ корректная сессия сохраняется', () => {
    expect(() => insertSession(seeded())).not.toThrow();
  });

  it.each([
    ['токен вместо его хэша', { token_hash: 'not-a-sha256' }],
    ['отзыв без причины', { revoked_at: START + 1 }],
    ['причина без отзыва', { revoke_reason: 'logout' }],
    ['неизвестная причина отзыва', { revoked_at: START + 1, revoke_reason: 'because' }],
    ['срок бездействия раньше последней активности', { idle_expires_at: START }],
    ['несуществующий пользователь', { user_id: 99 }],
  ])('❌ сессия: %s', (_name, columns) => {
    expect(() => insertSession(seeded(), columns)).toThrow();
  });

  it('✅ удаление пользователя удаляет его сессии (ON DELETE CASCADE)', () => {
    const db = seeded();
    insertSession(db);
    db.prepare('DELETE FROM users WHERE id = 1').run();
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
});

describe('первый оператор из окружения', () => {
  it('✅ создаётся при старте; повторный старт его не меняет', async () => {
    const passwordHash = await hashPassword('correct horse battery', FAST_PARAMS);
    const config = loadConfig({
      ...API_ENV,
      WEB_DATABASE_PATH: ':memory:',
      WEB_BOOTSTRAP_LOGIN: 'root',
      WEB_BOOTSTRAP_PASSWORD_HASH: passwordHash,
    });
    const services = createServices(config, () => START);
    expect(services.users.findByLogin('root')).toMatchObject({ role: 'operator', isActive: true, passwordHash });

    // оператор сменил пароль в интерфейсе — значение из окружения его не откатывает
    services.db.prepare("UPDATE users SET password_hash = ? WHERE login = 'root'").run(HASH);
    expect(services.users.bootstrapOperator('root', passwordHash, START + 1)).toBe(false);
    expect(services.users.findByLogin('root')?.passwordHash).toBe(HASH);
  });

  it('✅ без переменных окружения пользователей нет', () => {
    const services = createServices(loadConfig({ ...API_ENV, WEB_DATABASE_PATH: ':memory:' }), () => START);
    expect(services.db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
});

describe('конфиг', () => {
  it('✅ значения по умолчанию', () => {
    expect(loadConfig(API_ENV)).toEqual({
      databasePath: './data/web.db',
      bootstrap: null,
      trustProxy: false,
      api: { baseUrl: 'http://localhost:3000', viewerKey: VIEWER_KEY, operatorKey: OPERATOR_KEY, timeoutMs: 10_000 },
    });
  });

  it('✅ адрес api приводится к origin, таймаут читается из окружения', () => {
    const config = loadConfig({ ...API_ENV, API_BASE_URL: 'http://api:3000/', API_TIMEOUT_MS: '2500' });
    expect(config.api).toMatchObject({ baseUrl: 'http://api:3000', timeoutMs: 2500 });
  });

  it.each([
    ['логин без хэша', { WEB_BOOTSTRAP_LOGIN: 'root' }],
    ['хэш без логина', { WEB_BOOTSTRAP_PASSWORD_HASH: HASH }],
    ['логин вне формата', { WEB_BOOTSTRAP_LOGIN: 'Root User', WEB_BOOTSTRAP_PASSWORD_HASH: HASH }],
    ['пароль вместо хэша', { WEB_BOOTSTRAP_LOGIN: 'root', WEB_BOOTSTRAP_PASSWORD_HASH: 'correct horse battery' }],
    ['WEB_TRUST_PROXY не булево', { WEB_TRUST_PROXY: 'yes please' }],
    ['нет ключа viewer', { API_VIEWER_KEY: '' }],
    ['нет ключа operator', { API_OPERATOR_KEY: undefined }],
    ['ключ не того формата', { API_VIEWER_KEY: 'cpt_short' }],
    ['один ключ на обе роли', { API_OPERATOR_KEY: VIEWER_KEY }],
    ['адрес api с путём', { API_BASE_URL: 'http://api:3000/api/v1' }],
    ['адрес api с учётными данными', { API_BASE_URL: 'http://user:pass@api:3000' }],
    ['адрес api не http', { API_BASE_URL: 'file:///etc/passwd' }],
    ['адрес api — не URL', { API_BASE_URL: 'api:3000:1' }],
    ['таймаут не число', { API_TIMEOUT_MS: 'fast' }],
    ['таймаут вне диапазона', { API_TIMEOUT_MS: '5' }],
  ])('❌ %s → ошибка старта', (_name, env) => {
    expect(() => loadConfig({ ...API_ENV, ...env })).toThrow(ConfigError);
  });

  it('❌ сообщение об ошибке не содержит значение ключа api', () => {
    const typo = `${VIEWER_KEY}=`;
    expect(() => loadConfig({ ...API_ENV, API_VIEWER_KEY: typo })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining(VIEWER_KEY) }),
    );
  });

  it('❌ сообщение об ошибке не содержит значение секрета', () => {
    const secret = 'correct horse battery';
    expect(() => loadConfig({ ...API_ENV, WEB_BOOTSTRAP_LOGIN: 'root', WEB_BOOTSTRAP_PASSWORD_HASH: secret })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining(secret) }),
    );
  });
});
