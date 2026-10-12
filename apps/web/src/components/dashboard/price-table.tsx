import type { components } from '@/generated/api-types';
import type { LatestPriceListItem, SparklineWindow } from '@/lib/dashboard/queries';
import type { Flash } from '@/lib/dashboard/use-price-stream';
import { ChangeValue, PriceValue, Sparkline, StateTag, UpdatedAt } from './cells';

type SparklinePoint = components['schemas']['SparklinePoint'];

export const WINDOW_LABEL: Record<SparklineWindow, { short: string; long: string }> = {
  '24h': { short: '24 ч', long: '24 часа' },
  '7d': { short: '7 д', long: '7 дней' },
};

const NO_POINTS: readonly SparklinePoint[] = [];

export type PriceTableProps = {
  items: readonly LatestPriceListItem[];
  sparklines: ReadonlyMap<number, readonly SparklinePoint[]>;
  pausedIds: ReadonlySet<number>;
  flashes: ReadonlyMap<number, Flash>;
  window: SparklineWindow;
  now: number;
};

const TH = 'px-4 py-2 text-xs font-medium text-muted-foreground';
const TD = 'px-4 py-3 align-middle';

/**
 * Список цен в двух раскладках: таблица на широком экране, карточки на узком (решение Q7 дизайна: ни одна
 * колонка не теряется и нет горизонтальной прокрутки). Порядок строк задаёт сервер и от событий не меняется.
 */
export function PriceTable({ items, sparklines, pausedIds, flashes, window, now }: PriceTableProps) {
  const rows = items.map((item) => ({
    item,
    paused: pausedIds.has(item.cryptocurrencyId),
    flash: flashes.get(item.cryptocurrencyId),
    points: sparklines.get(item.cryptocurrencyId) ?? NO_POINTS,
    sparkLabel: `${item.symbol} за ${WINDOW_LABEL[window].long}`,
  }));

  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Отслеживаемые монеты: цена, изменение за 24 часа, мини-график, время обновления
          </caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className={TH}>
                Монета
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Цена, USD
              </th>
              <th scope="col" className={`${TH} text-right`}>
                24 ч
              </th>
              <th scope="col" className={TH}>
                График {WINDOW_LABEL[window].short}
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Обновлено
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, paused, flash, points, sparkLabel }) => (
              <tr key={item.cryptocurrencyId} className="border-b last:border-b-0">
                <td className={TD}>
                  <span className="font-semibold">{item.symbol}</span>{' '}
                  <span className="text-muted-foreground">{item.name}</span>
                  <div>
                    <StateTag paused={paused} stale={item.latest?.isStale ?? false} />
                  </div>
                </td>
                <td className={`${TD} text-right`}>
                  <PriceValue latest={item.latest} flash={flash} />
                </td>
                <td className={`${TD} text-right`}>
                  {item.latest && <ChangeValue change={item.latest.change24hPercent} />}
                </td>
                <td className={TD}>
                  <Sparkline points={points} label={sparkLabel} />
                </td>
                <td className={`${TD} text-right`}>
                  <UpdatedAt latest={item.latest} now={now} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y md:hidden" aria-label="Отслеживаемые монеты">
        {rows.map(({ item, paused, flash, points, sparkLabel }) => (
          <li key={item.cryptocurrencyId} className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 text-sm">
            <div>
              <div className="font-semibold">{item.symbol}</div>
              <div className="text-muted-foreground">{item.name}</div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <PriceValue latest={item.latest} flash={flash} />
              {item.latest && <ChangeValue change={item.latest.change24hPercent} />}
            </div>
            <Sparkline points={points} label={sparkLabel} />
            <div className="flex flex-col items-end justify-center gap-0.5 text-xs">
              <StateTag paused={paused} stale={item.latest?.isStale ?? false} />
              <UpdatedAt latest={item.latest} now={now} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const SKELETON = 'inline-block h-4 animate-pulse rounded bg-skeleton';

export function PriceTableSkeleton() {
  return (
    <ul className="divide-y" aria-busy="true" aria-label="Загрузка цен">
      {Array.from({ length: 5 }, (_, index) => (
        <li key={index} className="flex items-center justify-between gap-4 px-4 py-3.5">
          <span className={`${SKELETON} w-36`} />
          <span className={`${SKELETON} w-24`} />
        </li>
      ))}
    </ul>
  );
}
