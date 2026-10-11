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

type UserRow = { id: number; login: string; password_hash: string; role: string; is_active: number };

export class UserRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  findByLogin(login: string): User | null {
    const row = this.db
      .prepare('SELECT id, login, password_hash, role, is_active FROM users WHERE login = ?')
      .get(login) as UserRow | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      login: row.login,
      passwordHash: row.password_hash,
      role: row.role as Role,
      isActive: row.is_active === 1,
    };
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

  create(login: string, passwordHash: string, role: Role, now: number): number {
    const result = this.db
      .prepare(
        `INSERT INTO users (login, password_hash, role, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(login, passwordHash, role, now, now, now);
    return Number(result.lastInsertRowid);
  }

  setActive(id: number, isActive: boolean, now: number): void {
    this.db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, now, id);
  }

  markLogin(id: number, now: number): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, id);
  }
}
