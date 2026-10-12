import { Button } from '@/components/ui/button';
import type { ChartKind } from '@/lib/coin/chart-data';
import {
  comboIssue,
  INTERVAL_LABEL,
  INTERVALS,
  PERIOD_LABEL,
  PERIODS,
  type Interval,
  type Period,
} from '@/lib/coin/intervals';

type Option<T extends string> = { value: T; label: string; issue?: string | null };

/**
 * Группа кнопок-переключателей. Недоступный вариант не `disabled`, а `aria-disabled`: он остаётся в порядке
 * обхода клавиатурой и объясняет причину подсказкой — иначе непонятно, почему кнопка не нажимается.
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  onBlocked,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  onBlocked?: (issue: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        {label}
      </span>
      <div role="group" aria-label={label} className="flex gap-1">
        {options.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={option.value === value ? 'secondary' : 'ghost'}
            aria-pressed={option.value === value}
            aria-disabled={option.issue ? true : undefined}
            title={option.issue ?? undefined}
            className={option.issue ? 'cursor-not-allowed opacity-50' : undefined}
            onClick={() => (option.issue ? onBlocked?.(option.issue) : onChange(option.value))}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

const KINDS: readonly Option<ChartKind>[] = [
  { value: 'candles', label: 'Свечи' },
  { value: 'line', label: 'Линия' },
];

export type ChartControlsProps = {
  kind: ChartKind;
  interval: Interval;
  period: Period;
  onKind: (kind: ChartKind) => void;
  onInterval: (interval: Interval) => void;
  onPeriod: (period: Period) => void;
  /** Нажат недоступный вариант: причина показывается строкой под переключателями */
  onBlocked: (issue: string) => void;
};

export function ChartControls({ kind, interval, period, onKind, onInterval, onPeriod, onBlocked }: ChartControlsProps) {
  // Интервал проверяется с текущим периодом, период — с текущим интервалом: предел 1000 бакетов (ADR 0007)
  const intervals = INTERVALS.map((value) => ({
    value,
    label: INTERVAL_LABEL[value],
    issue: comboIssue(value, period),
  }));
  const periods = PERIODS.map((value) => ({ value, label: PERIOD_LABEL[value], issue: comboIssue(interval, value) }));
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Segmented label="Вид" options={KINDS} value={kind} onChange={onKind} />
      <Segmented label="Интервал" options={intervals} value={interval} onChange={onInterval} onBlocked={onBlocked} />
      <Segmented label="Период" options={periods} value={period} onChange={onPeriod} onBlocked={onBlocked} />
    </div>
  );
}
