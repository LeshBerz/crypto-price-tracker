// Пользователи web (ADR 0016). SQL спрятан здесь, наружу — доменные объекты.
import type { Database } from './db';

export type Role = 'viewer' | 'operator';

export type User = {
  id: number;
  login: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
};

/** Формат логина совпадает с CHECK в схеме: проверка до запроса даёт понятную ошибку вместо ошибки SQLite */
export const LOGIN_FORMAT = /^[a-z0-9._-]{3,32}$/;

export function normalizeLogin(input: string): string {
  return input.trim().toLowerCase();
}

/** Строка экрана «Пользователи»: без хэша пароля, с числом действующих сессий */
export type UserSummary = {
  id: number;
  login: string;
  role: Role;
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  activeSessions: number;
  /** Пароль выдан оператором и ещё не сменён */
  mustChangePassword: boolean;
};

type UserRow = { id: number; login: string; password_hash: string; role: string; is_active: number };
type SummaryRow = {
  id: number;
  login: string;
  role: string;
  is_active: number;
  created_at: number;
  last_login_at: number | null;
  active_sessions: number;
  must_change_password: number;
};

function toUser(row: UserRow): User {
  return {
    id: Number(row.id),
    login: row.login,
    passwordHash: row.password_hash,
    role: row.role as Role,
    isActive: row.is_active === 1,
  };
}

function toSummary(row: SummaryRow): UserSummary {
  return {
    id: Number(row.id),
    login: row.login,
    role: row.role as Role,
    isActive: row.is_active === 1,
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at === null ? null : Number(row.last_login_at),
    activeSessions: Number(row.active_sessions),
    mustChangePassword: row.must_change_password === 1,
  };
}

/**
 * Число действующих сессий считается подзапросом по частичному индексу `sessions_user_active`: один запрос на
 * весь список, без запроса на каждого пользователя. Условия те же, что в `SessionService.validate`.
 */
const SUMMARY_SQL = `
  SELECT u.id, u.login, u.role, u.is_active, u.created_at, u.last_login_at, u.must_change_password,
         (SELECT count(*) FROM sessions s
           WHERE s.user_id = u.id AND s.revoked_at IS NULL
             AND s.idle_expires_at > ? AND s.absolute_expires_at > ?) AS active_sessions
    FROM users u`;

export class UserRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  findByLogin(login: string): User | null {
    const row = this.db
      .prepare('SELECT id, login, password_hash, role, is_active FROM users WHERE login = ?')
      .get(login) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  findById(id: number): User | null {
    const row = this.db.prepare('SELECT id, login, password_hash, role, is_active FROM users WHERE id = ?').get(id) as
      UserRow | undefined;
    return row ? toUser(row) : null;
  }

  list(now: number): UserSummary[] {
    const rows = this.db.prepare(`${SUMMARY_SQL} ORDER BY u.login`).all(now, now) as SummaryRow[];
    return rows.map(toSummary);
  }

  summary(id: number, now: number): UserSummary | null {
    const row = this.db.prepare(`${SUMMARY_SQL} WHERE u.id = ?`).get(now, now, id) as SummaryRow | undefined;
    return row ? toSummary(row) : null;
  }

  /** Сколько операторов сейчас могут войти: по этому числу работает защита от потери доступа (ADR 0016) */
  countActiveOperators(): number {
    const row = this.db.prepare("SELECT count(*) AS n FROM users WHERE role = 'operator' AND is_active = 1").get();
    return Number(row?.n ?? 0);
  }

  /**
   * Первый оператор из окружения. Идемпотентно: существующий логин не трогаем, поэтому смена пароля
   * или отключение пользователя в интерфейсе не откатываются при рестарте.
   */
  bootstrapOperator(login: string, passwordHash: string, now: number): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO users (login, password_hash, role, created_at, updated_at, password_changed_at)
         VALUES (?, ?, 'operator', ?, ?, ?)
         ON CONFLICT (login) DO NOTHING`,
      )
      .run(login, passwordHash, now, now, now);
    return result.changes === 1;
  }

  /** `temporary` — пароль создал сервер и его видел оператор: при первом входе пользователь обязан его сменить */
  create(login: string, passwordHash: string, role: Role, now: number, temporary = false): number {
    const result = this.db
      .prepare(
        `INSERT INTO users (login, password_hash, role, created_at, updated_at, password_changed_at, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(login, passwordHash, role, now, now, now, temporary ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  setActive(id: number, isActive: boolean, now: number): void {
    this.db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, now, id);
  }

  setRole(id: number, role: Role, now: number): void {
    this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now, id);
  }

  /** `temporary: true` — сброс оператором; `false` — пользователь задал пароль сам, обязанность сменить снята */
  setPassword(id: number, passwordHash: string, now: number, temporary: boolean): void {
    this.db
      .prepare(
        `UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?, must_change_password = ?
         WHERE id = ?`,
      )
      .run(passwordHash, now, now, temporary ? 1 : 0, id);
  }

  markLogin(id: number, now: number): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, id);
  }
}
