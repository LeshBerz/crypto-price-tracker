import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import type { ReactNode } from 'react';

export type NoticeTone = 'warn' | 'info';

const TONE: Record<NoticeTone, string> = {
  warn: 'border-warn-border bg-warn-bg text-warn',
  info: 'border-info-border bg-info-bg text-info',
};

/** Полоса сообщения над содержимым экрана: значок и заголовок несут смысл и без цвета */
export function Notice({
  tone,
  Icon,
  title,
  children,
  action,
}: {
  tone: NoticeTone;
  Icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', TONE[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="font-semibold">{title}</strong>
        {children}
      </div>
      {action}
    </div>
  );
}
