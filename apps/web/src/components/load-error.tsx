import { CircleX, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BffError } from '@/lib/bff-client';

function errorText(error: unknown): string {
  if (!(error instanceof BffError)) return 'Неизвестная ошибка.';
  if (error.source === 'network') return 'Нет связи с сервером. Проверьте подключение к сети.';
  if (error.isUnavailable) return 'API не отвечает. Попробуйте ещё раз через минуту.';
  return error.problem?.detail ?? error.problem?.title ?? `Ошибка ${error.status}.`;
}

/** Блок не загрузился: причина, идентификатор запроса для поиска в логах и повтор */
export function LoadError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  const requestId = error instanceof BffError ? error.requestId : null;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm">
      <CircleX className="size-6 text-destructive" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <strong className="font-semibold">{title}</strong>
        <span className="text-muted-foreground">{errorText(error)}</span>
        {requestId && (
          <span className="text-xs text-muted-foreground">
            Идентификатор запроса: <code className="font-mono break-all">{requestId}</code>
          </span>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        Повторить
      </Button>
    </div>
  );
}
