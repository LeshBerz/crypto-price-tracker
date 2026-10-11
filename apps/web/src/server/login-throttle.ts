// Прогрессивная задержка входа по паре (логин, IP) — ADR 0016, OWASP Authentication Cheat Sheet.
// Аккаунт целиком не блокируется: иначе блокировку можно вызвать нарочно против настоящего пользователя.
import type { Database } from './db';

/** Первые 5 неудач — без ожидания, дальше 1 → 2 → 4 … секунд, не дольше 15 минут */
export const FREE_ATTEMPTS = 5;
export const BASE_DELAY_MS = 1000;
export const MAX_DELAY_MS = 15 * 60 * 1000;
/** Запись старше суток не влияет на вход и удаляется фоновой очисткой */
export const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

export function lockDelayMs(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  // Показатель ограничен, чтобы 2 ** n не вышло за безопасные целые при тысячах попыток
  const exponent = Math.min(failures - FREE_ATTEMPTS, 20);
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
}

type AttemptRow = { failures: number; last_failure: number };

export class LoginThrottle {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Сколько ещё ждать до следующей попытки; 0 — можно пробовать */
  retryAfterMs(login: string, ip: string, now: number): number {
    const row = this.db
      .prepare('SELECT failures, last_failure FROM login_attempts WHERE login = ? AND ip = ?')
      .get(login, ip) as AttemptRow | undefined;
    if (!row) return 0;
    const unlockAt = Number(row.last_failure) + lockDelayMs(Number(row.failures));
    return Math.max(0, unlockAt - now);
  }

  recordFailure(login: string, ip: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO login_attempts (login, ip, failures, last_failure) VALUES (?, ?, 1, ?)
         ON CONFLICT (login, ip) DO UPDATE SET failures = failures + 1, last_failure = excluded.last_failure`,
      )
      .run(login, ip, now);
  }

  reset(login: string, ip: string): void {
    this.db.prepare('DELETE FROM login_attempts WHERE login = ? AND ip = ?').run(login, ip);
  }

  purgeStale(now: number): number {
    const result = this.db.prepare('DELETE FROM login_attempts WHERE last_failure <= ?').run(now - ATTEMPT_TTL_MS);
    return Number(result.changes);
  }
}
