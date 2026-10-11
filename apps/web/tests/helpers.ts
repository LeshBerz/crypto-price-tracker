// Общая сборка для тестов: настоящая SQLite в памяти и управляемое время (тот же подход, что в api, ADR 0009).
import { AuthService } from '@/server/auth-service';
import type { ApiFetch } from '@/server/bff/upstream';
import type { ApiConfig, WebConfig } from '@/server/config';
import type { Services } from '@/server/container';
import { migrate, openDatabase } from '@/server/db';
import { LoginThrottle } from '@/server/login-throttle';
import { hashPassword, verifyPassword, type ScryptParams } from '@/server/passwords';
import { SessionService } from '@/server/sessions';
import { UserRepository, type Role } from '@/server/users';

/** Параметры scrypt для тестов: тот же код, но N = 2^10 вместо 2^17 — миллисекунды вместо 285 мс на хэш */
export const FAST_PARAMS: ScryptParams = { logN: 10, r: 8, p: 1 };

export const START = Date.UTC(2026, 9, 11, 12, 0, 0);

/** Ключи нужного формата, но случайные только на вид: настоящий api их не знает */
export const TEST_API: ApiConfig = {
  baseUrl: 'http://api.test:3000',
  viewerKey: `cpt_${'v'.repeat(43)}`,
  operatorKey: `cpt_${'o'.repeat(43)}`,
  timeoutMs: 1000,
};

export type LogEntry = { level: string; msg: string; fields: Record<string, unknown> };

export type TestContext = Services & {
  /** Ответ api для теста: по умолчанию запрос в api — ошибка теста */
  setApi(handler: ApiFetch): void;
  logs: LogEntry[];
  advance(ms: number): void;
  addUser(login: string, password: string, role?: Role): Promise<number>;
  verifyCalls: string[];
};

export function createTestContext(config: Partial<WebConfig> = {}): TestContext {
  let current = START;
  const now = () => current;
  const db = openDatabase(':memory:');
  migrate(db, now());
  const users = new UserRepository(db);
  const sessions = new SessionService(db, now);
  const throttle = new LoginThrottle(db);
  const verifyCalls: string[] = [];
  const logs: LogEntry[] = [];
  let api: ApiFetch = (input) => Promise.reject(new Error(`тест не ждал запроса в api: ${input}`));
  const dummy = hashPassword('no such user', FAST_PARAMS);
  const auth = new AuthService({
    users,
    sessions,
    throttle,
    now,
    verifyPassword: (password, stored) => {
      verifyCalls.push(stored);
      return verifyPassword(password, stored);
    },
    dummyHash: () => dummy,
  });
  return {
    config: { databasePath: ':memory:', bootstrap: null, trustProxy: false, api: TEST_API, ...config },
    apiFetch: (input, init) => api(input, init),
    log: (level, msg, fields = {}) => logs.push({ level, msg, fields }),
    logs,
    setApi: (handler) => {
      api = handler;
    },
    db,
    users,
    sessions,
    throttle,
    auth,
    now,
    verifyCalls,
    advance: (ms) => {
      current += ms;
    },
    addUser: async (login, password, role = 'viewer') =>
      users.create(login, await hashPassword(password, FAST_PARAMS), role, now()),
  };
}
