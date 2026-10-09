// Повтор временных сбоев CMC (ADR 0015 §4, D8): экспоненциальный backoff с jitter, ожидание — только через Clock.
// Пользуется SyncService (B12). HTTP-запросы клиента не ретраят: держать соединение десятки секунд хуже, чем 503 + Retry-After.
import type { Clock } from '../common/clock.ts';
import { MarketDataError } from './provider.ts';

export type RetryOptions = {
  clock: Clock;
  /** Всего попыток, включая первую */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Потолок ожидания по Retry-After: дольше синхронизацию не держим (ADR 0015) */
  maxRetryAfterMs?: number;
  /** [0, 1) — для детерминированных тестов */
  random?: () => number;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; error: MarketDataError; delayMs: number }) => void;
};

export const RETRY_DEFAULTS = { attempts: 3, baseDelayMs: 1000, maxDelayMs: 30_000, maxRetryAfterMs: 60_000 } as const;

/**
 * Задержка перед повтором номер attempt (1, 2, …): min(base · 2^(attempt−1), cap) · random(0.5…1).
 * Jitter разводит во времени клиентов, упавших одновременно: без него они все вернутся в одну секунду
 * и снова уронят сервис (thundering herd).
 */
export function backoffDelay(attempt: number, base: number, cap: number, random: () => number): number {
  return Math.round(Math.min(base * 2 ** (attempt - 1), cap) * (0.5 + random() * 0.5));
}

/** fn получает номер попытки (с 1). Неретраибельная ошибка и исчерпание попыток пробрасываются как есть */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? RETRY_DEFAULTS.attempts;
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (!(error instanceof MarketDataError) || !error.retryable || attempt >= attempts) throw error;
      const delayMs =
        error.retryAfterMs !== undefined
          ? Math.min(error.retryAfterMs, options.maxRetryAfterMs ?? RETRY_DEFAULTS.maxRetryAfterMs)
          : backoffDelay(
              attempt,
              options.baseDelayMs ?? RETRY_DEFAULTS.baseDelayMs,
              options.maxDelayMs ?? RETRY_DEFAULTS.maxDelayMs,
              random,
            );
      options.onRetry?.({ attempt, error, delayMs });
      // Отмена (shutdown) прерывает и ожидание: sleep отклоняется с signal.reason
      await options.clock.sleep(delayMs, options.signal);
    }
  }
}
