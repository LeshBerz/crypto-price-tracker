// Отметки гида по экранам (ADR 0018): какие туры пользователь уже прошёл или пропустил. SQL спрятан здесь.
import { TOUR_IDS, type TourId } from '@/lib/account/contract';
import type { Database } from './db';

export function isTourId(value: string): value is TourId {
  return (TOUR_IDS as readonly string[]).includes(value);
}

export class TourRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  completed(userId: number): TourId[] {
    const rows = this.db.prepare('SELECT tour FROM user_tours WHERE user_id = ? ORDER BY tour').all(userId) as {
      tour: string;
    }[];
    return rows.map((row) => row.tour).filter(isTourId);
  }

  /** Идемпотентно: повторная отметка не меняет время первой */
  complete(userId: number, tour: TourId, now: number): void {
    this.db
      .prepare('INSERT INTO user_tours (user_id, tour, completed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .run(userId, tour, now);
  }

  /** «Пройти гид заново»: возвращает число снятых отметок */
  reset(userId: number): number {
    return Number(this.db.prepare('DELETE FROM user_tours WHERE user_id = ?').run(userId).changes);
  }
}
