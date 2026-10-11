// Вход по логину и паролю (ADR 0016): задержка → проверка пароля → новая сессия.
import type { LoginThrottle } from './login-throttle';
import { PASSWORD_MAX_LENGTH } from './passwords';
import type { SessionMeta, SessionService } from './sessions';
import { LOGIN_FORMAT, normalizeLogin, type Role, type UserRepository } from './users';

export type LoginResult =
  | { ok: true; token: string; expiresAt: number; login: string; role: Role }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'throttled'; retryAfterMs: number };

export type AuthDeps = {
  users: UserRepository;
  sessions: SessionService;
  throttle: LoginThrottle;
  now: () => number;
  verifyPassword: (password: string, stored: string) => Promise<boolean>;
  /** Хэш несуществующего пароля: по нему считается scrypt, когда логина нет */
  dummyHash: () => Promise<string>;
};

export class AuthService {
  private readonly deps: AuthDeps;

  constructor(deps: AuthDeps) {
    this.deps = deps;
  }

  async login(loginInput: string, password: string, meta: SessionMeta): Promise<LoginResult> {
    const { users, sessions, throttle, now, verifyPassword, dummyHash } = this.deps;
    const login = normalizeLogin(loginInput);
    // Ключ задержки — присланный логин, даже несуществующий: иначе по задержке можно узнать, какие логины есть
    const key = login.slice(0, 64);
    const ip = meta.ip ?? 'unknown';

    const retryAfterMs = throttle.retryAfterMs(key, ip, now());
    if (retryAfterMs > 0) return { ok: false, reason: 'throttled', retryAfterMs };

    const user = LOGIN_FORMAT.test(login) ? users.findByLogin(login) : null;
    const candidate = password.length <= PASSWORD_MAX_LENGTH ? password : '';
    // Нет логина или пользователь отключён — scrypt всё равно считается: время ответа не выдаёт причину отказа
    const matches = await verifyPassword(candidate, user?.passwordHash ?? (await dummyHash()));

    if (!user || !user.isActive || !matches || candidate !== password) {
      throttle.recordFailure(key, ip, now());
      return { ok: false, reason: 'invalid' };
    }

    throttle.reset(key, ip);
    const session = sessions.create(user.id, meta);
    users.markLogin(user.id, now());
    return { ok: true, token: session.token, expiresAt: session.expiresAt, login: user.login, role: user.role };
  }
}
