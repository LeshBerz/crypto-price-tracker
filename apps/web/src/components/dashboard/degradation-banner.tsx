import { Info, RefreshCw, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Notice, type NoticeTone } from '@/components/notice';
import { Button } from '@/components/ui/button';
import type { Degradation } from '@/lib/dashboard/degradation';
import { formatClock, formatRelative, plural } from '@/lib/format';
import type { Role } from '@/server/users';

type Content = { tone: NoticeTone; Icon: LucideIcon; title: string; body: string };

const COINS = ['монеты', 'монет', 'монет'] as const;

function describe(degradation: Degradation, now: number): Content {
  switch (degradation.kind) {
    case 'api-unavailable':
      return {
        tone: 'warn',
        Icon: TriangleAlert,
        title: 'Нет связи с API',
        body: `Показаны данные на ${formatClock(new Date(degradation.shownAt).toISOString(), { seconds: true })}. Обновление возобновится само, когда связь восстановится.`,
      };
    case 'partial':
      return {
        tone: 'warn',
        Icon: TriangleAlert,
        title: 'Обновлены не все монеты',
        body: `Последняя синхронизация завершилась частично: у ${degradation.staleCount} ${plural(degradation.staleCount, COINS)} цены устарели — они отмечены в таблице.`,
      };
    case 'stale': {
      if (!degradation.all) {
        return {
          tone: 'warn',
          Icon: TriangleAlert,
          title: `Цены ${degradation.staleCount} ${plural(degradation.staleCount, COINS)} устарели`,
          body: 'Они отмечены в таблице: новые цены по ним не сохранялись дольше двух интервалов синхронизации.',
        };
      }
      const last = degradation.lastFetchedAt
        ? ` Последнее обновление — ${formatClock(degradation.lastFetchedAt)} (${formatRelative(degradation.lastFetchedAt, now)}).`
        : '';
      return degradation.sourceFailed
        ? {
            tone: 'warn',
            Icon: TriangleAlert,
            title: 'Цены устарели: CoinMarketCap недоступен',
            body: `Показаны последние сохранённые цены, они обновятся сами, когда источник восстановится.${last}`,
          }
        : {
            tone: 'warn',
            Icon: TriangleAlert,
            title: 'Цены устарели',
            body: `Новые цены не сохранялись дольше двух интервалов синхронизации.${last}`,
          };
    }
    case 'sync-failed': {
      const when = degradation.finishedAt ? ` в ${formatClock(degradation.finishedAt)}` : '';
      const outcome = degradation.status === 'failed' ? 'не удалась' : 'завершилась частично';
      const fresh = degradation.lastFetchedAt
        ? `Цены получены ${formatRelative(degradation.lastFetchedAt, now)} и пока актуальны. `
        : '';
      return {
        tone: 'info',
        Icon: Info,
        title: `Последняя синхронизация${when} ${outcome}`,
        body: `${fresh}Следующая попытка — по расписанию.`,
      };
    }
    case 'stream-offline':
      return {
        tone: 'info',
        Icon: WifiOff,
        title: 'Нет связи для обновлений в реальном времени',
        body: 'Переподключение идёт автоматически; после него таблица перечитается.',
      };
  }
}

/** Сбой источника или синхронизации: причину оператор смотрит на экране «Система» */
function pointsToSource(degradation: Degradation): boolean {
  return (
    degradation.kind === 'sync-failed' ||
    degradation.kind === 'partial' ||
    (degradation.kind === 'stale' && degradation.all)
  );
}

export function DegradationBanner({
  degradation,
  now,
  role,
  onRetry,
}: {
  degradation: Degradation;
  now: number;
  role: Role;
  onRetry: () => void;
}) {
  const { tone, Icon, title, body } = describe(degradation, now);
  const requestId = degradation.kind === 'api-unavailable' ? degradation.requestId : null;
  return (
    <Notice
      tone={tone}
      Icon={Icon}
      title={title}
      action={
        degradation.kind === 'api-unavailable' ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Повторить
          </Button>
        ) : (
          role === 'operator' &&
          pointsToSource(degradation) && (
            <Link
              href="/operator/system"
              className="shrink-0 rounded font-medium underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Состояние CMC
            </Link>
          )
        )
      }
    >
      <span>{body}</span>
      {requestId && (
        <span className="text-xs">
          Идентификатор запроса: <code className="font-mono break-all">{requestId}</code>
        </span>
      )}
    </Notice>
  );
}
