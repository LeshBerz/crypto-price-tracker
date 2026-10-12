// События потока → изменения кэша запросов. Сеть и React здесь не участвуют: функции проверяются тестами напрямую.
import type { QueryClient } from '@tanstack/react-query';
import {
  applyPriceToAggregates,
  applyPriceToCoin,
  nextLatest,
  prependHistoryPoint,
  type PriceUpdate,
} from '@/lib/coin/live-updates';
import { coinKeys, type Cryptocurrency, type PriceAggregates, type PriceHistory } from '@/lib/coin/queries';
import { compareDecimal, type Direction } from '@/lib/format';
import { dashboardKeys, type LatestPriceList, type RefreshTarget } from './queries';

export type { PriceUpdate };

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
      return { type: 'refresh', targets: ['prices', 'sparklines', 'coin', 'aggregates'] };
    // Карточка перечитывает монету: её могли переименовать, приостановить или удалить (тогда ответ — 404)
    case 'watchlist.changed':
      return { type: 'refresh', targets: ['prices', 'sparklines', 'coins', 'coin'] };
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
  const latest = nextLatest(previous, update);
  if (!latest) return { list, direction: 'flat' };

  const items = [...list.items];
  items[index] = { ...current, latest };
  return { list: { ...list, items }, direction: directionOf(update.price, previous?.price) };
}

function directionOf(price: string, previous: string | undefined): Direction {
  const comparison = previous === undefined ? 0 : compareDecimal(price, previous);
  return comparison > 0 ? 'up' : comparison < 0 ? 'down' : 'flat';
}

export type StreamEventContext = {
  queryClient: QueryClient;
  refresh: (targets: readonly RefreshTarget[]) => void;
  /** Цена монеты изменилась — для короткой подсветки ячейки */
  onPriceChange?: (cryptocurrencyId: number, direction: Exclude<Direction, 'flat'>) => void;
};

/** Список цен дашборда. Списка в кэше может не быть: открыта карточка монеты, а не дашборд */
function applyToPriceList(context: StreamEventContext, update: PriceUpdate): Direction {
  const list = context.queryClient.getQueryData<LatestPriceList>(dashboardKeys.prices);
  // Список ещё не загружен: первый ответ принесёт эту же цену
  if (!list) return 'flat';
  const applied = applyPriceUpdate(list, update);
  // Незнакомая монета: событие `watchlist.changed` потерялось — страховка перечитывает список
  if (!applied) {
    context.refresh(['prices', 'coins']);
    return 'flat';
  }
  if (applied.list !== list) context.queryClient.setQueryData(dashboardKeys.prices, applied.list);
  return applied.direction;
}

/** Данные карточки монеты: последняя цена, последняя свеча всех загруженных графиков и первая строка истории */
function applyToCoinCard(queryClient: QueryClient, update: PriceUpdate): Direction {
  const id = update.cryptocurrencyId;
  let direction: Direction = 'flat';
  const coin = queryClient.getQueryData<Cryptocurrency>(coinKeys.detail(id));
  if (coin) {
    const next = applyPriceToCoin(coin, update);
    if (next !== coin) {
      queryClient.setQueryData(coinKeys.detail(id), next);
      direction = directionOf(update.price, coin.latestPrice?.price);
    }
  }
  for (const query of queryClient.getQueryCache().findAll({ queryKey: coinKeys.aggregatesOf(id) })) {
    queryClient.setQueryData<PriceAggregates>(query.queryKey, (old) => old && applyPriceToAggregates(old, update));
  }
  queryClient.setQueryData<PriceHistory>(coinKeys.history(id), (old) => old && prependHistoryPoint(old, update));
  return direction;
}

export function handleStreamEvent(context: StreamEventContext, name: string, raw: string): void {
  const action = parseStreamEvent(name, raw);
  if (action.type === 'ignore') return;
  if (action.type === 'refresh') return context.refresh(action.targets);

  const inList = applyToPriceList(context, action.update);
  const inCard = applyToCoinCard(context.queryClient, action.update);
  const direction = inList !== 'flat' ? inList : inCard;
  if (direction !== 'flat') context.onPriceChange?.(action.update.cryptocurrencyId, direction);
}
