import { ArrowDown, ArrowUp, Minus, Pause, TriangleAlert } from 'lucide-react';
import { cn } from 'cn';
import { Hint } from '@/components/ui/tooltip';
import type { components } from '@/generated/api-types';
import type { Flash } from '@/lib/dashboard/use-price-stream';
import { formatChange, formatPrice, formatRelative, splitPrice } from '@/lib/format';
import { sparklineGeometry } from '@/lib/sparkline';

type LatestPrice = components['schemas']['LatestPrice'];
type SparklinePoint = components['schemas']['SparklinePoint'];

const FLASH_CLASS: Record<Flash, string> = { up: 'bg-up-bg', down: 'bg-down-bg' };

/** Цена. Округлённое значение — на экране, строка из api целиком — в подсказке (ui-flows §3.2) */
export function PriceValue({ latest, flash }: { latest: LatestPrice | null; flash?: Flash }) {
  if (!latest) return <span className="text-muted-foreground">ожидает первой синхронизации</span>;
  const formatted = formatPrice(latest.price);
  const { head, zeros, tail } = splitPrice(formatted);
  return (
    <Hint text={`${latest.price} ${latest.currency}`}>
      <span
        className={cn(
          '-mx-1 rounded px-1 font-mono tabular-nums transition-colors duration-700',
          latest.isStale && 'text-stale',
          flash && FLASH_CLASS[flash],
        )}
      >
        {head}
        {/* Ведущие нули приглушены, но остаются в тексте: число копируется и читается целиком */}
        {zeros && <span className="opacity-45">{zeros}</span>}
        {tail}
      </span>
    </Hint>
  );
}

/** Цена вне списка (сводка, подсказка графика, история): те же округление и приглушённые нули */
export function PriceText({ price, className }: { price: string; className?: string }) {
  const { head, zeros, tail } = splitPrice(formatPrice(price));
  return (
    <Hint text={`${price} USD`}>
      <span className={cn('font-mono tabular-nums', className)}>
        {head}
        {zeros && <span className="opacity-45">{zeros}</span>}
        {tail}
      </span>
    </Hint>
  );
}

const CHANGE_STYLE = {
  up: { className: 'text-up', Icon: ArrowUp },
  down: { className: 'text-down', Icon: ArrowDown },
  flat: { className: 'text-muted-foreground', Icon: Minus },
} as const;

/** Изменение за 24 ч: цвет и стрелка вместе — цвет не единственный сигнал */
export function ChangeValue({ change }: { change: string | null }) {
  if (change === null) {
    return (
      <Hint text="Истории меньше суток">
        <span className="text-muted-foreground">
          —<span className="sr-only">нет данных: истории меньше суток</span>
        </span>
      </Hint>
    );
  }
  const { text, direction } = formatChange(change);
  const { className, Icon } = CHANGE_STYLE[direction];
  return (
    <Hint text={`${change} %`}>
      <span className={cn('inline-flex items-center gap-0.5 font-mono tabular-nums', className)}>
        <Icon className="size-3.5" aria-hidden="true" />
        {text}
      </span>
    </Hint>
  );
}

const STROKE = { up: 'var(--up)', down: 'var(--down)', flat: 'var(--muted-foreground)' } as const;
const SPARK_WIDTH = 104;
const SPARK_HEIGHT = 30;

export function Sparkline({ points, label }: { points: readonly SparklinePoint[]; label: string }) {
  const geometry = sparklineGeometry(points, SPARK_WIDTH, SPARK_HEIGHT);
  if (!geometry) {
    return <span className="text-xs text-muted-foreground">нет данных</span>;
  }
  const first = points[0]?.close ?? '0';
  const last = points[points.length - 1]?.close ?? '0';
  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      role="img"
      aria-label={`${label}: с ${formatPrice(first)} до ${formatPrice(last)}`}
    >
      <path
        d={geometry.path}
        fill="none"
        stroke={STROKE[geometry.trend]}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const TAG = 'inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap';

/** Пауза — штатное действие оператора: нейтральная метка без предупреждения (ADR 0017) */
export function StateTag({ paused, stale }: { paused: boolean; stale: boolean }) {
  if (paused) {
    return (
      <Hint text="Синхронизация приостановлена оператором">
        <span className={cn(TAG, 'bg-muted text-muted-foreground')}>
          <Pause className="size-3" aria-hidden="true" />
          пауза
        </span>
      </Hint>
    );
  }
  if (stale) {
    return (
      <Hint text="Цена старше двух интервалов синхронизации">
        <span className={cn(TAG, 'bg-warn-bg text-warn')}>
          <TriangleAlert className="size-3" aria-hidden="true" />
          устарела
        </span>
      </Hint>
    );
  }
  return null;
}

export function UpdatedAt({ latest, now }: { latest: LatestPrice | null; now: number }) {
  if (!latest) return <span className="text-muted-foreground">—</span>;
  return (
    <Hint text={`Получено ${latest.fetchedAt} · котировка CoinMarketCap ${latest.sourceUpdatedAt} (UTC)`}>
      <time dateTime={latest.fetchedAt} className="text-muted-foreground tabular-nums">
        {formatRelative(latest.fetchedAt, now)}
      </time>
    </Hint>
  );
}
