// Что не так с данными на экране — одним баннером, самая серьёзная причина первой (ui-flows §3.2).
import type { LatestPriceList } from './queries';
import type { StreamStatus } from './stream-connection';

export type Degradation =
  /** Перезапрос не удался: на экране данные последнего успешного ответа */
  | { kind: 'api-unavailable'; shownAt: number; requestId: string | null }
  /** Часть монет не обновилась в последнем запуске */
  | { kind: 'partial'; staleCount: number }
  /**
   * Цены старше двух интервалов синхронизации. `all` — устарели все активные монеты: тогда есть смысл назвать
   * время последнего обновления; иначе оно относится к свежим монетам и только запутает
   */
  | { kind: 'stale'; staleCount: number; all: boolean; sourceFailed: boolean; lastFetchedAt: string | null }
  /** Запуск не удался, но цены ещё в пределах допустимого возраста */
  | { kind: 'sync-failed'; status: 'failed' | 'partial'; finishedAt: string | null; lastFetchedAt: string | null }
  | { kind: 'stream-offline' };

export type DegradationInput = {
  prices: LatestPriceList | undefined;
  /** `null` — список монет ещё не загружен: отличить паузу от сбоя пока нельзя */
  pausedIds: ReadonlySet<number> | null;
  /** Ошибка последнего запроса цен при наличии данных */
  refreshError: { requestId: string | null } | null;
  pricesUpdatedAt: number;
  streamStatus: StreamStatus;
};

export function detectDegradation(input: DegradationInput): Degradation | null {
  const { prices, pausedIds, refreshError, streamStatus } = input;
  if (!prices) return null;
  if (refreshError) {
    return { kind: 'api-unavailable', shownAt: input.pricesUpdatedAt, requestId: refreshError.requestId };
  }

  // Монета на паузе устаревает штатно: в деградацию она не идёт (ADR 0017)
  if (pausedIds) {
    const active = prices.items.filter((item) => item.latest && !pausedIds.has(item.cryptocurrencyId));
    const staleCount = active.filter((item) => item.latest?.isStale).length;
    // ISO 8601 в UTC сортируется как строка
    const lastFetchedAt =
      active
        .map((item) => item.latest?.fetchedAt ?? '')
        .sort()
        .at(-1) ?? null;
    const status = prices.lastSync?.status;

    if (staleCount > 0 && status === 'partial') return { kind: 'partial', staleCount };
    if (staleCount > 0) {
      const all = staleCount === active.length;
      return { kind: 'stale', staleCount, all, sourceFailed: status === 'failed', lastFetchedAt };
    }
    if (status === 'failed' || status === 'partial') {
      return { kind: 'sync-failed', status, finishedAt: prices.lastSync?.finishedAt ?? null, lastFetchedAt };
    }
  }

  // Первое подключение («connecting») — не сбой
  return streamStatus === 'reconnecting' ? { kind: 'stream-offline' } : null;
}
