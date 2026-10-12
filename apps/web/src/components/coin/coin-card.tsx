'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Info, Pause, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChangeValue, PriceValue, StateTag } from '@/components/dashboard/cells';
import { LoadError } from '@/components/load-error';
import { Notice } from '@/components/notice';
import { StreamIndicator } from '@/components/stream-indicator';
import { bff, BffError } from '@/lib/bff-client';
import type { ChartKind } from '@/lib/coin/chart-data';
import {
  DEFAULT_INTERVAL,
  DEFAULT_PERIOD,
  MIN_BUCKETS,
  PERIOD_LABEL,
  type Interval,
  type Period,
} from '@/lib/coin/intervals';
import { aggregatesQuery, coinQuery, historyQuery, mergeHistoryPages, type Cryptocurrency } from '@/lib/coin/queries';
import { useNow, usePriceStream, type Flash } from '@/lib/dashboard/use-price-stream';
import { CoinAvatar } from '@/components/coin-avatar';
import { Timestamp } from '@/components/timestamp';
import { formatClock, plural } from '@/lib/format';
import { ChartControls } from './chart-controls';
import { CoinSummary, CoinSummarySkeleton } from './coin-summary';
import { HistoryTable } from './history-table';
import { NotTracked } from './not-tracked';
import { PriceChart } from './price-chart';

const CARD = 'overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10';
const SKELETON = 'animate-pulse rounded bg-skeleton';
const POINTS = ['точка', 'точки', 'точек'] as const;

function isNotFound(error: unknown): boolean {
  return error instanceof BffError && error.status === 404;
}

function CoinHeader({ coin, flash, now }: { coin: Cryptocurrency; flash: Flash | undefined; now: number }) {
  const latest = coin.latestPrice;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex items-center gap-3">
        <CoinAvatar symbol={coin.symbol} size="lg" />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {coin.symbol} <span className="font-medium text-muted-foreground">· {coin.name}</span>
          </h1>
          <span className="text-xs text-muted-foreground">
            CMC #{coin.cmcId} · отслеживается с <Timestamp iso={coin.createdAt} format="date" />
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1 sm:items-end">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-semibold">
            <PriceValue latest={latest} flash={flash} />
          </span>
          {latest && (
            <span className="inline-flex items-baseline gap-1 text-sm">
              <ChangeValue change={latest.change24hPercent} />
              <span className="text-muted-foreground">за 24 ч</span>
            </span>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <StateTag paused={coin.isPaused} stale={latest?.isStale ?? false} />
          {latest && (
            <>
              <span>
                Обновлено <Timestamp iso={latest.fetchedAt} format="relative" now={now} />
              </span>
              <span>
                · котировка CMC <Timestamp iso={latest.sourceUpdatedAt} format="clock" seconds />
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-end justify-between gap-6" aria-busy="true" aria-label="Загрузка монеты">
      <span className={`${SKELETON} h-10 w-48`} />
      <span className={`${SKELETON} h-10 w-40`} />
    </div>
  );
}

/** Одна причина — одна полоса: недоступность api важнее паузы, пауза объясняет устаревшую цену */
function CoinNotice({ coin, refreshFailed }: { coin: Cryptocurrency; refreshFailed: boolean }) {
  const latest = coin.latestPrice;
  if (refreshFailed) {
    return (
      <Notice tone="warn" Icon={TriangleAlert} title="Нет связи с API">
        <span>Показаны сохранённые данные. Обновление возобновится само, когда связь восстановится.</span>
      </Notice>
    );
  }
  if (coin.isPaused) {
    return (
      <Notice tone="info" Icon={Pause} title="Синхронизация приостановлена">
        <span>Оператор поставил монету на паузу: новые цены не запрашиваются, история сохранена.</span>
      </Notice>
    );
  }
  if (latest?.isStale) {
    return (
      <Notice tone="warn" Icon={TriangleAlert} title="Цена устарела">
        <span>
          Последнее обновление — {formatClock(latest.fetchedAt)}: новые цены не сохранялись дольше двух интервалов
          синхронизации. График и история показывают сохранённые данные.
        </span>
      </Notice>
    );
  }
  return null;
}

export function CoinCard({ id }: { id: number }) {
  const [kind, setKind] = useState<ChartKind>('candles');
  const [interval, selectInterval] = useState<Interval>(DEFAULT_INTERVAL);
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [blocked, setBlocked] = useState<string | null>(null);

  const coin = useQuery(coinQuery(bff, id));
  // Удалённая монета: фоновый запрос по `watchlist.changed` вернул 404, хотя прежние данные ещё в кэше
  const gone = isNotFound(coin.error);
  // При смене периода прежний график остаётся на экране, пока грузится новый: без мигания пустым блоком
  const aggregates = useQuery({
    ...aggregatesQuery(bff, id, interval, period),
    placeholderData: keepPreviousData,
    enabled: !gone,
  });
  // Историю поддерживает поток: новая точка дописывается из события, после переподключения перечитывается
  // первая страница. Автоматическое перечитывание запросило бы заново каждую открытую страницу
  const history = useInfiniteQuery({ ...historyQuery(bff, id), staleTime: Infinity, enabled: !gone });
  const { status: streamStatus, flashes } = usePriceStream();
  const now = useNow();

  const points = useMemo(() => (history.data ? mergeHistoryPages(history.data.pages) : null), [history.data]);

  if (gone) return <NotTracked />;

  const select = <T,>(apply: (value: T) => void) => {
    return (value: T) => {
      setBlocked(null);
      apply(value);
    };
  };
  const retry = () => {
    void coin.refetch();
    void aggregates.refetch();
    void history.refetch();
  };

  const buckets = aggregates.data?.buckets;
  const shownPeriod = aggregates.isPlaceholderData ? null : period;
  const sparse = buckets !== undefined && !aggregates.isPlaceholderData && buckets.length < MIN_BUCKETS;
  const pointCount = aggregates.data?.summary?.points ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Навигация">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Дашборд
        </Link>
      </nav>

      {coin.data && <CoinHeader coin={coin.data} flash={flashes.get(id)} now={now} />}
      {!coin.data && !coin.isError && <HeaderSkeleton />}
      {!coin.data && coin.isError && (
        <div className={CARD}>
          <LoadError title="Не удалось загрузить монету" error={coin.error} onRetry={retry} />
        </div>
      )}

      {/* aria-live только у сообщений: тики цены скринридеру не зачитываются (ui-flows §5) */}
      <div role="status" aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {coin.data && <CoinNotice coin={coin.data} refreshFailed={coin.isError} />}
        {sparse && (
          <Notice tone="info" Icon={Info} title="Данных пока мало">
            <span>
              История копится с момента добавления монеты: CoinMarketCap на тарифе Basic не отдаёт прошлые цены. Сейчас
              — {pointCount} {plural(pointCount, POINTS)} за {PERIOD_LABEL[period]}.
            </span>
          </Notice>
        )}
      </div>

      <section aria-labelledby="chart-title" className={CARD}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-3">
          <h2 id="chart-title" className="sr-only">
            График цены
          </h2>
          <ChartControls
            kind={kind}
            interval={interval}
            period={period}
            onKind={select(setKind)}
            onInterval={select(selectInterval)}
            onPeriod={select(setPeriod)}
            onBlocked={setBlocked}
          />
          <span className="ml-auto">
            <StreamIndicator status={streamStatus} />
          </span>
        </div>
        <p role="status" className="px-4 pt-2 text-xs text-muted-foreground empty:hidden">
          {blocked}
        </p>
        <div className="pt-3" aria-busy={aggregates.isFetching}>
          {!buckets && aggregates.isError && (
            <LoadError title="Не удалось загрузить график" error={aggregates.error} onRetry={retry} />
          )}
          {!buckets && !aggregates.isError && <div className={`${SKELETON} mx-4 mb-4 h-72 md:h-96`} />}
          {buckets?.length === 0 && (
            <p className="px-4 pb-6 text-sm text-muted-foreground">
              За {PERIOD_LABEL[period]} данных нет: график появится после первой синхронизации.
            </p>
          )}
          {buckets && buckets.length > 0 && coin.data && (
            <PriceChart
              symbol={coin.data.symbol}
              buckets={buckets}
              interval={aggregates.data?.interval ?? interval}
              kind={kind}
            />
          )}
        </div>
      </section>

      <section aria-labelledby="summary-title" className="flex flex-col gap-2">
        <h2 id="summary-title" className="font-semibold">
          Сводка{shownPeriod ? ` за ${PERIOD_LABEL[shownPeriod]}` : ''}
        </h2>
        {aggregates.data ? <CoinSummary summary={aggregates.data.summary} /> : <CoinSummarySkeleton />}
      </section>

      <section aria-labelledby="history-title" className={CARD}>
        <div className="flex flex-wrap items-baseline gap-x-3 border-b px-4 py-3">
          <h2 id="history-title" className="font-semibold">
            История цен
          </h2>
          <span className="text-xs text-muted-foreground">сырые точки, от новых к старым</span>
        </div>
        {!points && history.isError && (
          <LoadError title="Не удалось загрузить историю" error={history.error} onRetry={retry} />
        )}
        {!points && !history.isError && <div className={`${SKELETON} m-4 h-40`} />}
        {points && (
          <HistoryTable
            points={points}
            hasMore={history.hasNextPage}
            loadingMore={history.isFetchingNextPage}
            onLoadMore={() => void history.fetchNextPage()}
          />
        )}
      </section>
    </div>
  );
}
