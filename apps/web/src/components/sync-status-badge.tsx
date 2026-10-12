import { Badge } from '@/components/ui/badge';
import type { components } from '@/generated/api-types';
import { cn } from '@/lib/utils';

export type SyncStatus = components['schemas']['SyncRunStatus'];

const SYNC_STATUS: Record<SyncStatus, { text: string; className: string }> = {
  succeeded: { text: 'успешно', className: 'bg-up-bg text-up' },
  partial: { text: 'частично', className: 'bg-warn-bg text-warn' },
  failed: { text: 'не удалась', className: 'bg-error-bg text-destructive' },
  running: { text: 'идёт', className: 'bg-info-bg text-info' },
  interrupted: { text: 'прервана', className: 'bg-warn-bg text-warn' },
};

/** Статус запуска синхронизации: текст несёт смысл и без цвета (ui-flows §3.6) */
export function SyncStatusBadge({ status, className }: { status: SyncStatus; className?: string }) {
  const { text, className: tone } = SYNC_STATUS[status];
  return <Badge className={cn(tone, className)}>{text}</Badge>;
}
