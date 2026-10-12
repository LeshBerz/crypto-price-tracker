// События потока → изменения кэша запросов. Сеть и React здесь не участвуют: функции проверяются тестами напрямую.
import type { QueryClient } from '@tanstack/react-query';
import { compareDecimal, type Direction } from '@/lib/format';
import { dashboardKeys, type LatestPriceList, type RefreshTarget } from './queries';

export type PriceUpdate = {
  cryptocurrencyId: number;
  price: string;
  currency: string;
  sourceUpdatedAt: string;
  fetchedAt: string;
};

export type StreamAction =
  { type: 'price'; update: PriceUpdate } | { type: 'refresh'; targets: readonly RefreshTarget[] } | { type: 'ignore' };

const IGNORE: StreamAction = { type: 'ignore' };

function parsePriceUpdate(data: unknown): PriceUpdate | null {
  if (typeof data !== 'object' || data === null) return null;
  const { cryptocurrencyId, price, currency, sourceUpdatedAt, fetchedAt } = data as Record<string, unknown>;
  if (
    typeof cryptocurrencyId !== 'number' ||
    typeof price !== 'string' ||
    typeof currency !== 'string' ||
    typeof sourceUpdatedAt !== 'string' ||
    typeof fetchedAt !== 'string'
  ) {
    return null;
  }
  return { cryptocurrencyId, price, currency, sourceUpdatedAt, fetchedAt };
}

/**
 * Что делать с событием. Данные потока приходят извне и проверяются по форме: событие с битым JSON или без
 * нужных полей пропускается, а не роняет экран.
 */
export function parseStreamEvent(name: string, raw: string): StreamAction {
  switch (name) {
    case 'price.updated': {
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return IGNORE;
      }
      const update = parsePriceUpdate(data);
      return update ? { type: 'price', update } : IGNORE;
    }
    // Изменение за 24 ч и признак «устарела» считает сервер: после синхронизации они перечитываются (решение Q5)
    case 'sync.finished':
      return { type: 'refresh', targets: ['prices', 'sparklines'] };
    case 'watchlist.changed':
      return { type: 'refresh', targets: ['prices', 'sparklines', 'coins'] };
    default:
      return IGNORE;
  }
}

export type AppliedUpdate = { list: LatestPriceList; direction: Direction };

/**
 * Новая цена в списке. Порядок строк не меняется. `null` — монеты в списке нет: вызывающий перечитывает список.
 * Только что сохранённая цена устаревшей быть не может, поэтому `isStale` сбрасывается сразу; изменение за 24 ч
 * остаётся прежним до ближайшего `sync.finished`.
 */
export function applyPriceUpdate(list: LatestPriceList, update: PriceUpdate): AppliedUpdate | null {
  const index = list.items.findIndex((item) => item.cryptocurrencyId === update.cryptocurrencyId);
  const current = list.items[index];
  if (!current) return null;

  const previous = current.latest;
  // События могут прийти не по порядку (переподключение): более старая цена новую не затирает
  if (previous && Date.parse(update.fetchedAt) < Date.parse(previous.fetchedAt)) return { list, direction: 'flat' };

  const comparison = previous ? compareDecimal(update.price, previous.price) : 0;
  const items = [...list.items];
  items[index] = {
    ...current,
    latest: {
      price: update.price,
      currency: update.currency as LatestPriceList['currency'],
      sourceUpdatedAt: update.sourceUpdatedAt,
      fetchedAt: update.fetchedAt,
      change24hPercent: previous?.change24hPercent ?? null,
      isStale: false,
    },
  };
  return { list: { ...list, items }, direction: comparison > 0 ? 'up' : comparison < 0 ? 'down' : 'flat' };
}

export type StreamEventContext = {
  queryClient: QueryClient;
  refresh: (targets: readonly RefreshTarget[]) => void;
  /** Цена монеты изменилась — для короткой подсветки ячейки */
  onPriceChange?: (cryptocurrencyId: number, direction: Exclude<Direction, 'flat'>) => void;
};

export function handleStreamEvent(context: StreamEventContext, name: string, raw: string): void {
  const action = parseStreamEvent(name, raw);
  if (action.type === 'ignore') return;
  if (action.type === 'refresh') return context.refresh(action.targets);

  const list = context.queryClient.getQueryData<LatestPriceList>(dashboardKeys.prices);
  // Список ещё не загружен: первый ответ принесёт эту же цену
  if (!list) return;
  const applied = applyPriceUpdate(list, action.update);
  // Незнакомая монета: событие `watchlist.changed` потерялось — страховка перечитывает список
  if (!applied) return context.refresh(['prices', 'coins']);
  if (applied.list === list) return;
  context.queryClient.setQueryData(dashboardKeys.prices, applied.list);
  if (applied.direction !== 'flat') context.onPriceChange?.(action.update.cryptocurrencyId, applied.direction);
}
