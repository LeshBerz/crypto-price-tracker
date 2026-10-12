// Управление пользователями (ADR 0016): создание, роль, отключение, сброс и смена пароля.
// Про HTTP сервис не знает: отказы — доменные ошибки, в Problem Details их переводят обработчики маршрутов.
// Аналог в Nest — @Injectable() UsersService; зависимости переданы конструктору явно.
import { randomBytes } from 'node:crypto';
import { inTransaction, type Database } from './db';
import type { LoginThrottle } from './login-throttle';
import { isAcceptablePassword } from './passwords';
import type { SessionService } from './sessions';
import { LOGIN_FORMAT, normalizeLogin, type Role, type UserRepository, type UserSummary } from './users';

export type UserAdminErrorKind = 'invalid-login' | 'login-taken' | 'not-found' | 'last-operator' | 'own-password-reset';

export class UserAdminError extends Error {
  override name = 'UserAdminError';
  readonly kind: UserAdminErrorKind;

  constructor(kind: UserAdminErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Проверка по имени, а не `instanceof`: сервисы создаются один раз на процесс и лежат в `globalThis`
 * (container.ts), а сборка Next кладёт этот модуль в несколько чанков — у каждого свой экземпляр класса.
 * Ошибка, брошенная сервисом из одного чанка, для `instanceof` в другом — чужая (найдено на собранном образе:
 * занятый логин давал 500 вместо 409, хотя тесты в Jest, где модуль один, проходили).
 */
export function isUserAdminError(error: unknown): error is UserAdminError {
  return error instanceof Error && error.name === 'UserAdminError' && 'kind' in error;
}

export type PasswordChangeResult =
  | { ok: true; revokedSessions: number }
  | { ok: false; reason: 'weak-password' | 'same-password' | 'wrong-password' }
  | { ok: false; reason: 'throttled'; retryAfterMs: number };

export type UserAdminDeps = {
  db: Database;
  users: UserRepository;
  sessions: SessionService;
  throttle: LoginThrottle;
  now: () => number;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, stored: string) => Promise<boolean>;
};

/**
 * Временный пароль: 15 случайных байт в base64url — 20 символов, 120 бит. Создаёт сервер, а не оператор:
 * слабый пароль выбрать нельзя, а постоянного пароля пользователя оператор не знает.
 */
export function generatePassword(): string {
  return randomBytes(15).toString('base64url');
}

export class UserAdminService {
  private readonly deps: UserAdminDeps;

  constructor(deps: UserAdminDeps) {
    this.deps = deps;
  }

  list(): UserSummary[] {
    return this.deps.users.list(this.deps.now());
  }

  async create(loginInput: string, role: Role): Promise<{ user: UserSummary; temporaryPassword: string }> {
    const { users, now, hashPassword } = this.deps;
    const login = normalizeLogin(loginInput);
    if (!LOGIN_FORMAT.test(login)) {
      throw new UserAdminError(
        'invalid-login',
        'Логин: 3–32 символа, латинские буквы, цифры, точка, дефис, подчёркивание',
      );
    }
    // Проверка до хэширования экономит ~285 мс scrypt на заведомо отклонённом запросе
    if (users.findByLogin(login)) throw taken(login);

    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);
    // Пока считался scrypt, тот же логин мог занять другой запрос: вторая проверка — на стороне UNIQUE
    let id: number;
    try {
      id = users.create(login, passwordHash, role, now(), true);
    } catch (error) {
      if (users.findByLogin(login)) throw taken(login);
      throw error;
    }
    return { user: this.require(id), temporaryPassword };
  }

  /**
   * Смена роли или статуса. Любое изменение прав отзывает сессии пользователя: роль читается из БД на каждом
   * запросе, но открытые вкладки нарисованы под прежнюю роль. Проверка «последний оператор» и запись идут
   * синхронно, в одной транзакции: между ними не вклинится запрос второго оператора.
   */
  update(id: number, patch: { role?: Role; isActive?: boolean }): { user: UserSummary; revokedSessions: number } {
    const { db, users, sessions, now } = this.deps;
    const revokedSessions = inTransaction(db, () => {
      const user = users.findById(id);
      if (!user) throw notFound(id);
      const role = patch.role ?? user.role;
      const isActive = patch.isActive ?? user.isActive;
      const roleChanged = role !== user.role;
      const activeChanged = isActive !== user.isActive;
      if (!roleChanged && !activeChanged) return 0;

      const wasOperator = user.role === 'operator' && user.isActive;
      const staysOperator = role === 'operator' && isActive;
      if (wasOperator && !staysOperator && users.countActiveOperators() <= 1) {
        throw new UserAdminError(
          'last-operator',
          'Это последний активный оператор: без него управлять пользователями и watchlist будет некому',
        );
      }

      if (roleChanged) users.setRole(id, role, now());
      if (activeChanged) users.setActive(id, isActive, now());
      if (!isActive) return sessions.revokeAllForUser(id, 'user_disabled');
      return roleChanged ? sessions.revokeAllForUser(id, 'admin') : 0;
    });
    return { user: this.require(id), revokedSessions };
  }

  /**
   * Сброс пароля оператором. Свой пароль так не сбрасывается: ответ с новым паролем пришёл бы в сессию,
   * которая этим же запросом отозвана. Для своего пароля есть смена в профиле.
   */
  async resetPassword(
    id: number,
    actorId: number,
  ): Promise<{ user: UserSummary; temporaryPassword: string; revokedSessions: number }> {
    const { db, users, sessions, now, hashPassword } = this.deps;
    if (!users.findById(id)) throw notFound(id);
    if (id === actorId) {
      throw new UserAdminError('own-password-reset', 'Свой пароль меняется в профиле: нужен текущий пароль');
    }
    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const revokedSessions = inTransaction(db, () => {
      users.setPassword(id, passwordHash, now(), true);
      return sessions.revokeAllForUser(id, 'password_changed');
    });
    return { user: this.require(id), temporaryPassword, revokedSessions };
  }

  /**
   * Смена своего пароля. Текущий пароль обязателен: украденная сессия сама по себе пароль не сменит.
   * Перебор текущего пароля через этот маршрут упирается в ту же задержку, что и перебор на входе.
   * После смены отзываются все сессии, включая текущую, — нужен новый вход (session fixation, ADR 0016).
   */
  async changeOwnPassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip: string | null,
  ): Promise<PasswordChangeResult> {
    const { db, users, sessions, throttle, now, hashPassword, verifyPassword } = this.deps;
    const user = users.findById(userId);
    if (!user) throw notFound(userId);
    if (!isAcceptablePassword(newPassword)) return { ok: false, reason: 'weak-password' };

    const key = user.login;
    const address = ip ?? 'unknown';
    const retryAfterMs = throttle.retryAfterMs(key, address, now());
    if (retryAfterMs > 0) return { ok: false, reason: 'throttled', retryAfterMs };

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throttle.recordFailure(key, address, now());
      return { ok: false, reason: 'wrong-password' };
    }
    if (newPassword === currentPassword) return { ok: false, reason: 'same-password' };

    const passwordHash = await hashPassword(newPassword);
    const revokedSessions = inTransaction(db, () => {
      users.setPassword(userId, passwordHash, now(), false);
      return sessions.revokeAllForUser(userId, 'password_changed');
    });
    throttle.reset(key, address);
    return { ok: true, revokedSessions };
  }

  private require(id: number): UserSummary {
    const user = this.deps.users.summary(id, this.deps.now());
    if (!user) throw notFound(id);
    return user;
  }
}

function notFound(id: number): UserAdminError {
  return new UserAdminError('not-found', `Пользователь ${id} не найден`);
}

function taken(login: string): UserAdminError {
  return new UserAdminError('login-taken', `Логин ${login} уже занят`);
}
