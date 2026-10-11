// Серверные сессии (ADR 0016, OWASP Session Management): в cookie — случайный токен, в БД — только его SHA-256.
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from './db';
import type { Role } from './users';

/** Бездействие 2 ч, абсолютный предел 12 ч */
export const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** last_seen_at продлевается не чаще раза в минуту: иначе каждый запрос — запись в БД */
export const TOUCH_INTERVAL_MS = 60 * 1000;

export type RevokeReason = 'logout' | 'logout_all' | 'admin' | 'password_changed' | 'user_disabled';

export type SessionMeta = { ip: string | null; userAgent: string | null };

export type Session = {
  tokenHash: string;
  userId: number;
  login: string;
  role: Role;
  /** Раньше из двух сроков: бездействие или абсолютный предел */
  expiresAt: number;
};

/** 32 случайных байта в base64url — ровно 43 символа */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type SessionRow = {
  token_hash: string;
  user_id: number;
  login: string;
  role: string;
  last_seen_at: number;
  idle_expires_at: number;
  absolute_expires_at: number;
};

export class SessionService {
  private readonly db: Database;
  private readonly now: () => number;

  constructor(db: Database, now: () => number) {
    this.db = db;
    this.now = now;
  }

  /** Новый токен при каждом входе: защита от session fixation */
  create(userId: number, meta: SessionMeta): { token: string; expiresAt: number } {
    const now = this.now();
    // 256 бит энтропии (OWASP требует не меньше 64): перебор невозможен, поэтому хватает быстрого SHA-256
    const token = randomBytes(32).toString('base64url');
    const absolute = now + ABSOLUTE_TIMEOUT_MS;
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hashToken(token),
        userId,
        now,
        now,
        now + IDLE_TIMEOUT_MS,
        absolute,
        meta.ip?.slice(0, 45) ?? null,
        meta.userAgent?.slice(0, 512) ?? null,
      );
    return { token, expiresAt: absolute };
  }

  /**
   * Одна выборка по первичному ключу: сессия не отозвана, не истекла, пользователь активен.
   * touch: false — проверка без продления срока бездействия: для фоновых запросов, за которыми нет действия
   * пользователя (перепроверка открытого SSE-потока).
   */
  validate(token: string | undefined, { touch = true }: { touch?: boolean } = {}): Session | null {
    if (!token || !TOKEN_FORMAT.test(token)) return null;
    const now = this.now();
    const row = this.db
      .prepare(
        `SELECT s.token_hash, s.user_id, u.login, u.role, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND u.is_active = 1
           AND s.idle_expires_at > ? AND s.absolute_expires_at > ?`,
      )
      .get(hashToken(token), now, now) as SessionRow | undefined;
    if (!row) return null;

    let idleExpiresAt = Number(row.idle_expires_at);
    const absoluteExpiresAt = Number(row.absolute_expires_at);
    if (touch && now - Number(row.last_seen_at) >= TOUCH_INTERVAL_MS) {
      idleExpiresAt = Math.min(now + IDLE_TIMEOUT_MS, absoluteExpiresAt);
      this.db
        .prepare('UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE token_hash = ?')
        .run(now, idleExpiresAt, row.token_hash);
    }
    return {
      tokenHash: row.token_hash,
      userId: Number(row.user_id),
      login: row.login,
      role: row.role as Session['role'],
      expiresAt: Math.min(idleExpiresAt, absoluteExpiresAt),
    };
  }

  revoke(token: string | undefined, reason: RevokeReason): boolean {
    if (!token || !TOKEN_FORMAT.test(token)) return false;
    const result = this.db
      .prepare('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(this.now(), reason, hashToken(token));
    return result.changes === 1;
  }

  revokeAllForUser(userId: number, reason: RevokeReason): number {
    const result = this.db
      .prepare('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(this.now(), reason, userId);
    return Number(result.changes);
  }

  /** Удаляются сессии, чей срок вышел, — и действующие когда-то, и отозванные: до этого момента отзыв виден в аудите */
  purgeExpired(): number {
    const now = this.now();
    const result = this.db
      .prepare('DELETE FROM sessions WHERE absolute_expires_at <= ? OR idle_expires_at <= ?')
      .run(now, now);
    return Number(result.changes);
  }
}
