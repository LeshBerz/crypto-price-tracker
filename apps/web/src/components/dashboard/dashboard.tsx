'use client';

import { useQuery } from '@tanstack/react-query';
import { ChartSpline, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { LoadError } from '@/components/load-error';
import { StreamIndicator } from '@/components/stream-indicator';
import { SyncStatusBadge } from '@/components/sync-status-badge';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/panel';
import { Segmented } from '@/components/ui/segmented';
import { Timestamp } from '@/components/timestamp';
import { bff, BffError } from '@/lib/bff-client';
import { detectDegradation } from '@/lib/dashboard/degradation';
import {
  coinsQuery,
  pricesQuery,
  sparklinesQuery,
  type LatestPriceList,
  type SparklineWindow,
} from '@/lib/dashboard/queries';
import { useNow, usePriceStream } from '@/lib/dashboard/use-price-stream';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Role } from '@/server/users';
import { DegradationBanner } from './degradation-banner';
import { PriceTable, PriceTableSkeleton, WINDOW_LABEL } from './price-table';

function SyncLine({ lastSync }: { lastSync: LatestPriceList['lastSync'] }) {
  if (!lastSync) {
    return (
      <p data-tour="sync-line" className="text-sm text-muted-foreground">
        Синхронизаций ещё не было
      </p>
    );
  }
  return (
    <p data-tour="sync-line" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      Последняя синхронизация:
      {lastSync.finishedAt && <Timestamp iso={lastSync.finishedAt} format="clock" seconds />}
      <SyncStatusBadge status={lastSync.status} />
    </p>
  );
}

function WindowToggle({ value, onChange }: { value: SparklineWindow; onChange: (window: SparklineWindow) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span id="window-label" className="text-xs text-muted-foreground">
        Мини-график
      </span>
      <Segmented labelledBy="window-label" value={value} onChange={onChange} options={WINDOW_OPTIONS} />
    </div>
  );
}

const WINDOW_OPTIONS = (['24h', '7d'] as const).map((window) => ({ value: window, label: WINDOW_LABEL[window].short }));

function NothingTracked({ role }: { role: Role }) {
  return (
    <EmptyState
      Icon={ChartSpline}
      title="Пока ничего не отслеживается"
      action={
        role === 'operator' && (
          <Link href="/operator/watchlist" className={cn(buttonVariants({ size: 'sm' }))}>
            <Plus aria-hidden="true" />
            Добавить монету
          </Link>
        )
      }
    >
      {role === 'operator'
        ? 'Цены появятся после добавления первой монеты и ближайшей синхронизации.'
        : 'Оператор ещё не добавил монеты.'}
    </EmptyState>
  );
}

const COINS = ['монета', 'монеты', 'монет'] as const;

export function Dashboard({ role }: { role: Role }) {
  const [window, setWindow] = useState<SparklineWindow>('24h');
  const prices = useQuery(pricesQuery(bff));
  // Часовая свёртка меняется раз в час, а после синхронизации графики перечитывает событие потока
  const sparklines = useQuery({ ...sparklinesQuery(bff, window), staleTime: 5 * 60_000 });
  // Список монет нужен только ради признака паузы: кэшируется до события `watchlist.changed` (ADR 0017)
  const coins = useQuery({ ...coinsQuery(bff), staleTime: Infinity });
  const { status: streamStatus, flashes } = usePriceStream();
  const now = useNow();

  const pausedIds = useMemo(
    () => (coins.data ? new Set(coins.data.items.filter((coin) => coin.isPaused).map((coin) => coin.id)) : null),
    [coins.data],
  );
  const sparklinesByCoin = useMemo(
    () => new Map(sparklines.data?.items.map((item) => [item.cryptocurrencyId, item.points])),
    [sparklines.data],
  );

  const refreshError =
    prices.data && prices.error
      ? { requestId: prices.error instanceof BffError ? prices.error.requestId : null }
      : null;
  const degradation = detectDegradation({
    prices: prices.data,
    pausedIds,
    refreshError,
    pricesUpdatedAt: prices.dataUpdatedAt,
    streamStatus,
  });
  const retry = () => {
    void prices.refetch();
    void sparklines.refetch();
    void coins.refetch();
  };

  const items = prices.data?.items;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Дашборд</h1>
          {prices.data && <SyncLine lastSync={prices.data.lastSync} />}
        </div>
        <WindowToggle value={window} onChange={setWindow} />
      </div>

      {/* aria-live только у баннера: тики цен скринридеру не зачитываются (ui-flows §5) */}
      <div role="status" aria-live="polite">
        {degradation && <DegradationBanner degradation={degradation} now={now} role={role} onRetry={retry} />}
      </div>

      <Panel aria-labelledby="watchlist-title">
        <PanelHeader
          title="Watchlist"
          titleId="watchlist-title"
          meta={
            items && (
              <Badge variant="secondary">
                {items.length} {plural(items.length, COINS)}
              </Badge>
            )
          }
        >
          <StreamIndicator status={streamStatus} />
        </PanelHeader>
        {!items && prices.isError && (
          <LoadError title="Не удалось загрузить цены" error={prices.error} onRetry={retry} />
        )}
        {!items && !prices.isError && <PriceTableSkeleton />}
        {items?.length === 0 && <NothingTracked role={role} />}
        {items && items.length > 0 && (
          <PriceTable
            items={items}
            sparklines={sparklinesByCoin}
            pausedIds={pausedIds ?? EMPTY_IDS}
            flashes={flashes}
            window={window}
            now={now}
          />
        )}
      </Panel>
    </div>
  );
}

const EMPTY_IDS: ReadonlySet<number> = new Set();
