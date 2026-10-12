// Composition root серверной части web: одна БД и один набор сервисов на процесс.
import { AuthService } from './auth-service';
import { loadConfig, type WebConfig } from './config';
import type { ApiFetch } from './bff/upstream';
import { migrate, openDatabase, type Database } from './db';
import { consoleLog, type Log } from './log';
import { readRootEnv } from './root-env';
import { LoginThrottle } from './login-throttle';
import { hashPassword, verifyPassword } from './passwords';
import { SessionService } from './sessions';
import { UserAdminService } from './user-admin';
import { UserRepository } from './users';

export type Services = {
  config: WebConfig;
  db: Database;
  users: UserRepository;
  sessions: SessionService;
  throttle: LoginThrottle;
  auth: AuthService;
  userAdmin: UserAdminService;
  now: () => number;
  /** fetch для запросов в api: в тестах подменяется */
  apiFetch: ApiFetch;
  log: Log;
};

export function createServices(config: WebConfig, now: () => number = Date.now): Services {
  const db = openDatabase(config.databasePath);
  migrate(db, now());
  const users = new UserRepository(db);
  if (config.bootstrap) users.bootstrapOperator(config.bootstrap.login, config.bootstrap.passwordHash, now());
  const sessions = new SessionService(db, now);
  const throttle = new LoginThrottle(db);

  // Фиктивный хэш считается один раз и с боевыми параметрами: отказ «нет такого логина» стоит столько же, сколько
  // отказ «неверный пароль»
  let dummy: Promise<string> | null = null;
  const dummyHash = () => (dummy ??= hashPassword('no such user'));

  const auth = new AuthService({ users, sessions, throttle, now, verifyPassword, dummyHash });
  const userAdmin = new UserAdminService({ db, users, sessions, throttle, now, hashPassword, verifyPassword });
  return {
    config,
    db,
    users,
    sessions,
    throttle,
    auth,
    userAdmin,
    now,
    apiFetch: (input, init) => fetch(input, init),
    log: consoleLog,
  };
}

// В dev Next перезагружает модули при каждой правке: без globalThis каждая перезагрузка открывала бы БД заново
const holder = globalThis as typeof globalThis & { __cptWebServices?: Services };

export function getServices(): Services {
  // Приоритет: переменные процесса (в том числе `.env.local`, который загрузил Next) → общий `.env` в корне
  return (holder.__cptWebServices ??= createServices(loadConfig({ ...readRootEnv(), ...process.env })));
}
