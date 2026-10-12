import { cn } from 'cn';
import type { StreamStatus } from '@/lib/dashboard/stream-connection';

const STREAM: Record<StreamStatus, { text: string; dot: string }> = {
  open: { text: 'Обновляется в реальном времени', dot: 'bg-up' },
  connecting: { text: 'Подключение…', dot: 'bg-muted-foreground' },
  reconnecting: { text: 'Переподключение…', dot: 'border border-muted-foreground' },
};

/** Точка закрашена — поток открыт, пустая — нет: состояние читается и без цвета */
export function StreamIndicator({ status }: { status: StreamStatus }) {
  const { text, dot } = STREAM[status];
  return (
    <span data-tour="stream" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
      {text}
    </span>
  );
}
