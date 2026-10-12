'use client';

import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesDataItemTypeMap,
  type Time,
} from 'lightweight-charts';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChangeValue, PriceText } from '@/components/dashboard/cells';
import {
  bucketTime,
  planSeriesUpdate,
  priceStep,
  toChartPoints,
  type ChartKind,
  type ChartPoint,
} from '@/lib/coin/chart-data';
import { INTERVAL_LABEL, type Interval } from '@/lib/coin/intervals';
import type { PriceBucket } from '@/lib/coin/queries';
import { formatAxisPrice, formatUtc } from '@/lib/format';

type Series = ISeriesApi<'Candlestick' | 'Line'>;
type SeriesData = SeriesDataItemTypeMap<Time>['Candlestick' | 'Line'];

type Palette = { background: string; text: string; grid: string; up: string; down: string; line: string };

/** Canvas не понимает переменные CSS: цвета темы читаются из вычисленных стилей и передаются графику значениями */
function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: read('--card'),
    text: read('--muted-foreground'),
    grid: read('--border'),
    up: read('--up'),
    down: read('--down'),
    line: read('--primary'),
  };
}

function chartColors(palette: Palette) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: palette.background },
      textColor: palette.text,
      // Требование лицензии Lightweight Charts (ADR 0012); вторая ссылка — в подвале страницы
      attributionLogo: true,
    },
    grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
    rightPriceScale: { borderColor: palette.grid },
    timeScale: { borderColor: palette.grid },
  };
}

function seriesColors(kind: ChartKind, palette: Palette) {
  return kind === 'line'
    ? { color: palette.line }
    : {
        upColor: palette.up,
        downColor: palette.down,
        wickUpColor: palette.up,
        wickDownColor: palette.down,
        borderVisible: false,
      };
}

const KIND_LABEL: Record<ChartKind, string> = { candles: 'свечи', line: 'линия' };

export type PriceChartProps = {
  symbol: string;
  buckets: readonly PriceBucket[];
  interval: Interval;
  kind: ChartKind;
};

/**
 * Обёртка над Lightweight Charts. Библиотека императивная: график создаётся один раз, дальше эффект приводит
 * его к данным — `series.update()` для последней свечи, `setData()` при смене периода. Подсказка под курсором
 * отрисована в React из исходных строк бакета, а не из чисел графика.
 */
export function PriceChart({ symbol, buckets, interval, kind }: PriceChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ kind: ChartKind; api: Series } | null>(null);
  /** Точки, которые сейчас нарисованы: с ними сравниваются новые данные */
  const shownRef = useRef<readonly ChartPoint[]>([]);
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const legendId = useId();

  const points = useMemo(() => toChartPoints(buckets, interval, kind), [buckets, interval, kind]);
  const byTime = useMemo(() => new Map(buckets.map((bucket) => [bucketTime(bucket), bucket])), [buckets]);
  const lastBucket = buckets[buckets.length - 1];
  const step = priceStep(lastBucket?.stats.close ?? '1');

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, {
      // Размер задан сразу: до первого срабатывания ResizeObserver график не должен считать ширину нулевой,
      // иначе `fitContent()` сожмёт ряд в полоску у правого края
      width: element.clientWidth,
      height: element.clientHeight,
      autoSize: true,
      ...chartColors(readPalette()),
      // Шкала времени — UTC, как и границы бакетов api: дневная свеча начинается в 00:00 UTC
      localization: { locale: 'ru-RU', dateFormat: 'dd.MM.yyyy', priceFormatter: formatAxisPrice },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const onMove = (param: MouseEventParams<Time>) => setActiveTime(typeof param.time === 'number' ? param.time : null);
    chart.subscribeCrosshairMove(onMove);

    // Тему переключает атрибут на <html> (см. theme-toggle): график перекрашивается без пересоздания
    const observer = new MutationObserver(() => {
      const palette = readPalette();
      chart.applyOptions(chartColors(palette));
      const series = seriesRef.current;
      if (series) series.api.applyOptions(seriesColors(series.kind, palette));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let series = seriesRef.current;
    if (!series || series.kind !== kind) {
      if (series) chart.removeSeries(series.api);
      const options = seriesColors(kind, readPalette());
      const api = (kind === 'line'
        ? chart.addSeries(LineSeries, options)
        : chart.addSeries(CandlestickSeries, options)) as unknown as Series;
      series = { kind, api };
      seriesRef.current = series;
      shownRef.current = [];
    }
    series.api.applyOptions({ priceFormat: { type: 'custom', minMove: step, formatter: formatAxisPrice } });

    const plan = planSeriesUpdate(shownRef.current, points);
    if (plan.type === 'reset') {
      series.api.setData(points as SeriesData[]);
      chart.timeScale().fitContent();
    } else if (plan.type === 'update') {
      for (const point of plan.points) series.api.update(point as SeriesData);
    }
    shownRef.current = points;
  }, [kind, points, step]);

  const active = (activeTime !== null ? byTime.get(activeTime) : undefined) ?? lastBucket;

  const moveTo = (bucket: PriceBucket | undefined) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!bucket || !chart || !series) return;
    const time = bucketTime(bucket);
    chart.setCrosshairPosition(Number(bucket.stats.close), time as Time, series.api);
    setActiveTime(time);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = active ? buckets.indexOf(active) : buckets.length - 1;
    const target =
      event.key === 'ArrowLeft'
        ? current - 1
        : event.key === 'ArrowRight'
          ? current + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buckets.length - 1
              : null;
    if (event.key === 'Escape') {
      chartRef.current?.clearCrosshairPosition();
      setActiveTime(null);
      return;
    }
    if (target === null) return;
    event.preventDefault();
    moveTo(buckets[Math.min(buckets.length - 1, Math.max(0, target))]);
  };

  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <Legend id={legendId} bucket={active} kind={kind} />
      <div
        ref={container}
        tabIndex={0}
        role="group"
        aria-roledescription="график"
        aria-label={`${symbol}: ${KIND_LABEL[kind]}, интервал ${INTERVAL_LABEL[interval]}. Стрелки влево и вправо — перемещение по бакетам.`}
        aria-describedby={legendId}
        onKeyDown={onKeyDown}
        className="h-72 w-full rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-96"
      />
      <p className="text-xs text-muted-foreground">
        Время на шкале — UTC: по нему выровнены бакеты.{' '}
        {kind === 'candles'
          ? 'Пустые промежутки — бакеты без данных, они не достраиваются.'
          : 'Линия соединяет соседние точки; бакеты без данных видны в режиме свечей.'}
      </p>
    </div>
  );
}

const ITEM = 'inline-flex items-baseline gap-1';
const KEY = 'text-xs text-muted-foreground';

/** Значения бакета под курсором (или последнего): строки api, точность не теряется */
function Legend({ id, bucket, kind }: { id: string; bucket: PriceBucket | undefined; kind: ChartKind }) {
  if (!bucket) return <div id={id} className="min-h-5" />;
  const { open, close, min, max, changePercent, points } = bucket.stats;
  return (
    <div id={id} aria-live="polite" className="flex min-h-5 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
      <time dateTime={bucket.bucketStart} className="text-muted-foreground">
        {formatUtc(Date.parse(bucket.bucketStart))}
      </time>
      {kind === 'candles' && (
        <>
          <span className={ITEM}>
            <span className={KEY}>Откр.</span>
            <PriceText price={open} />
          </span>
          <span className={ITEM}>
            <span className={KEY}>Макс.</span>
            <PriceText price={max} />
          </span>
          <span className={ITEM}>
            <span className={KEY}>Мин.</span>
            <PriceText price={min} />
          </span>
        </>
      )}
      <span className={ITEM}>
        <span className={KEY}>Закр.</span>
        <PriceText price={close} />
      </span>
      <ChangeValue change={changePercent} />
      <span className={ITEM}>
        <span className={KEY}>точек</span>
        <span className="font-mono tabular-nums">{points}</span>
      </span>
    </div>
  );
}
