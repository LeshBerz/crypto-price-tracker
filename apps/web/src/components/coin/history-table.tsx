import { PriceText } from '@/components/dashboard/cells';
import { Button } from '@/components/ui/button';
import type { PricePoint } from '@/lib/coin/queries';
import { Timestamp } from '@/components/timestamp';
import { TH } from '@/components/ui/panel';

/** История плотнее остальных таблиц: строк много, действий в строке нет */
const TD = 'px-4 py-2.5 align-middle';

export type HistoryTableProps = {
  points: readonly PricePoint[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

/** Сырые точки истории, от новых к старым. Следующая страница — по курсору api, а не по номеру (ADR 0014) */
export function HistoryTable({ points, hasMore, loadingMore, onLoadMore }: HistoryTableProps) {
  if (points.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">Точек пока нет: цена появится после синхронизации.</p>
    );
  }
  return (
    <>
      <table className="w-full text-sm">
        <caption className="sr-only">История цен: время получения, цена, время котировки CoinMarketCap</caption>
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className={TH}>
              Получено
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Цена, USD
            </th>
            <th scope="col" className={`${TH} text-right max-sm:hidden`}>
              Котировка CMC
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr
              key={point.sourceUpdatedAt}
              className="animate-row-in border-b transition-colors duration-(--duration-fast) last:border-b-0 hover:bg-muted/50"
            >
              <td className={TD}>
                <Timestamp iso={point.fetchedAt} seconds />
              </td>
              <td className={`${TD} text-right`}>
                <PriceText price={point.price} />
              </td>
              <td className={`${TD} text-right max-sm:hidden`}>
                <Timestamp iso={point.sourceUpdatedAt} format="clock" seconds className="text-muted-foreground" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 border-t px-4 py-3">
        {hasMore ? (
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Загрузка…' : 'Загрузить ещё'}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Это все точки</span>
        )}
      </div>
    </>
  );
}
