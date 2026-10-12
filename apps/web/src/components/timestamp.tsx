'use client';

import { cn } from 'cn';
import { Hint } from '@/components/ui/tooltip';
import { formatClock, formatDate, formatDateTime, formatRelative } from '@/lib/format';

type TimestampProps = {
  iso: string;
  className?: string;
} & (
  | { format?: 'datetime' | 'clock'; seconds?: boolean; now?: never }
  | { format: 'date'; seconds?: never; now?: never }
  | { format: 'relative'; now: number; seconds?: never }
);

/**
 * Момент времени на экране: короткая запись в поясе браузера, точное значение UTC — в подсказке и в `dateTime`.
 * Один компонент на все экраны: одинаковый шрифт (цифры одной ширины, без моноширинного) и одна подсказка.
 */
export function Timestamp(props: TimestampProps) {
  const { iso, className } = props;
  const text =
    props.format === 'relative'
      ? formatRelative(iso, props.now)
      : props.format === 'date'
        ? formatDate(iso)
        : props.format === 'clock'
          ? formatClock(iso, { seconds: props.seconds })
          : formatDateTime(iso, { seconds: props.seconds });
  return (
    <Hint text={`${iso} (UTC)`}>
      <time dateTime={iso} className={cn('tabular-nums', className)}>
        {text}
      </time>
    </Hint>
  );
}
