import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
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

/** Подпись и переключатель в одну строку; подпись связана с группой через `aria-labelledby` */
function Control<T extends string>({
  id,
  label,
  ...props
}: { id: string; label: string } & Omit<Parameters<typeof Segmented<T>>[0], 'labelledBy'>) {
  return (
    <div className="flex items-center gap-2">
      <span id={id} className="text-xs text-muted-foreground">
        {label}
      </span>
      <Segmented labelledBy={id} {...props} />
    </div>
  );
}

const KINDS: readonly SegmentedOption<ChartKind>[] = [
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
    disabledReason: comboIssue(value, period),
  }));
  const periods = PERIODS.map((value) => ({
    value,
    label: PERIOD_LABEL[value],
    disabledReason: comboIssue(interval, value),
  }));
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Control id="chart-kind" label="Вид" options={KINDS} value={kind} onChange={onKind} />
      <Control
        id="chart-interval"
        label="Интервал"
        options={intervals}
        value={interval}
        onChange={onInterval}
        onBlocked={onBlocked}
      />
      <Control
        id="chart-period"
        label="Период"
        options={periods}
        value={period}
        onChange={onPeriod}
        onBlocked={onBlocked}
      />
    </div>
  );
}
