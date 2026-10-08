// Детерминированное время для тестов (ADR 0009): now() стоит на месте, пока тест не вызовет advance().
import type { Clock } from '../../src/common/clock.ts';
import { T0 } from './db.ts';

type Sleeper = { at: number; resolve: () => void };

export class FakeClock implements Clock {
  private current: number;
  private sleepers: Sleeper[] = [];

  constructor(start: number = T0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  /** Сколько sleep ещё ждут — удобно проверять, что ретрай действительно ушёл в ожидание */
  get pendingSleeps(): number {
    return this.sleepers.length;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const sleeper: Sleeper = {
        at: this.current + ms,
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      const onAbort = () => {
        this.sleepers = this.sleepers.filter((s) => s !== sleeper);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.sleepers.push(sleeper);
    });
  }

  /**
   * Сдвигает время на ms, по очереди будя спящих. После каждого пробуждения отдаёт управление
   * циклу событий: продолжение после await успевает выполниться и заснуть снова — так цепочка
   * «ретрай → sleep → ретрай» проходит за один advance.
   */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const next = this.sleepers.filter((s) => s.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.sleepers = this.sleepers.filter((s) => s !== next);
      this.current = next.at;
      next.resolve();
      await new Promise((r) => setImmediate(r));
    }
    this.current = target;
  }
}
