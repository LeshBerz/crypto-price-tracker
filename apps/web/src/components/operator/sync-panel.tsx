'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LoadError } from '@/components/load-error';
import { Notice } from '@/components/notice';
import { SyncStatusBadge } from '@/components/sync-status-badge';
import { Timestamp } from '@/components/timestamp';
import { Button } from '@/components/ui/button';
import { EmptyState, Panel, PanelHeader, TH } from '@/components/ui/panel';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { bff, BffError } from '@/lib/bff-client';
import { usePriceStream } from '@/lib/dashboard/use-price-stream';
import { formatClock, formatDuration, formatInterval } from '@/lib/format';
import {
  cmcStatusQuery,
  mergeRunPages,
  operatorKeys,
  syncRunsQuery,
  upsertRun,
  type SyncRun,
  type SyncRuns,
} from '@/lib/operator/queries';
import { readSchedule, runDurationMs, type Schedule } from '@/lib/operator/system';
import { describeFailure } from '@/lib/operator/watchlist';
import { cn } from '@/lib/utils';

/** Журнал плотнее остальных таблиц: строк много, действий в строке нет */
const TD = 'px-4 py-2.5 align-middle';
const ROW = 'animate-row-in border-b transition-colors duration-(--duration-base) last:border-b-0';
const COLUMNS = [
  { width: 'w-8' },
  { width: 'w-32' },
  { width: 'w-10', right: true },
  { width: 'w-24' },
  { width: 'w-16' },
  { width: 'w-8', right: true },
  { width: 'w-6', right: true },
  { width: 'w-6', right: true },
  { width: 'w-10' },
];

const TRIGGER: Record<SyncRun['trigger'], string> = {
  schedule: 'по расписанию',
  manual: 'вручную',
  startup: 'при старте',
};

const SCHEDULER: Record<Schedule['state'], string> = {
  running: 'работает',
  stopped: 'остановлен',
  disabled: 'выключен',
};

function Started({ run }: { run: SyncRun }) {
  return <Timestamp iso={run.startedAt} seconds />;
}

function Duration({ run }: { run: SyncRun }) {
  const ms = runDurationMs(run);
  return <span className="tabular-nums">{ms === null ? '—' : formatDuration(ms)}</span>;
}

function RunError({ run }: { run: SyncRun }) {
  if (!run.error) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <code className="font-mono text-xs">{run.error.code}</code>
      <span className="text-xs text-muted-foreground">{run.error.message}</span>
    </span>
  );
}

/** Что сейчас: идущий запуск или итог последнего завершённого */
function Now({ runs }: { runs: readonly SyncRun[] }) {
  const running = runs.find((run) => run.status === 'running');
  const last = runs.find((run) => run.status !== 'running');
  const shown = running ?? last;
  if (!shown) return <span className="text-muted-foreground">Запусков ещё не было</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <SyncStatusBadge status={shown.status} />
      {running ? (
        <span>
          запуск #{running.id} начат в {formatClock(running.startedAt, { seconds: true })}
        </span>
      ) : (
        <span>
          запуск #{shown.id} · {formatClock(shown.finishedAt ?? shown.startedAt, { seconds: true })} · сохранено{' '}
          {shown.pricesSaved} из {shown.coinsRequested}
        </span>
      )}
    </span>
  );
}

function NextRun({ schedule, running }: { schedule: Schedule; running: boolean }) {
  if (schedule.state !== 'running') return <span>не запланирован: планировщик {SCHEDULER[schedule.state]}</span>;
  if (running || !schedule.nextRunAt) return <span>после завершения текущего</span>;
  return (
    <span>
      ≈ <Timestamp iso={schedule.nextRunAt} format="clock" seconds />{' '}
      <span className="text-muted-foreground">({formatInterval(schedule.intervalMs)})</span>
    </span>
  );
}

/**
 * Синхронизация (ui-flows §3.6). Ручной запуск отвечает 202: работа ещё идёт, строка запуска попадает
 * в журнал из ответа api. Завершение приносит событие `sync.finished` — журнал перечитывается фоновым запросом,
 * опроса по таймеру нет. Экран читает только состояние потока, чтобы честно сказать, когда событий не будет.
 */
export function SyncPanel() {
  const queryClient = useQueryClient();
  const runsQuery = useInfiniteQuery(syncRunsQuery(bff));
  const cmc = useQuery(cmcStatusQuery(bff));
  const { status: streamStatus } = usePriceStream();
  const [highlighted, setHighlighted] = useState<number | null>(null);

  const runs = useMemo(() => (runsQuery.data ? mergeRunPages(runsQuery.data.pages) : null), [runsQuery.data]);
  const schedule = readSchedule(cmc.data);
  const running = runs?.some((run) => run.status === 'running') ?? false;

  const trigger = useMutation({
    mutationFn: () => bff.send('post', '/api/v1/sync-runs', {}),
    onSuccess: (run) => {
      queryClient.setQueryData<SyncRuns>(operatorKeys.syncRuns, (old) => upsertRun(old, run));
      setHighlighted(run.id);
      toast.info(`Синхронизация #${run.id} запущена`, 'Итог появится в журнале, когда запуск завершится.');
    },
    onError: async (error) => {
      const conflict = error instanceof BffError && error.status === 409;
      if (!conflict) return toast.error('Синхронизация не запущена', describeFailure(error));
      // Запуск уже идёт (расписание или другой оператор): журнал перечитывается, строка подсвечивается
      const id = error.problem?.conflictingId ?? null;
      toast.info(id === null ? 'Синхронизация уже идёт' : `Синхронизация уже идёт (#${id})`);
      await runsQuery.refetch();
      setHighlighted(id);
      if (id !== null) document.getElementById(`run-${id}`)?.scrollIntoView({ block: 'center' });
    },
  });

  const busy = trigger.isPending || running;
  return (
    <div className="flex flex-col gap-4">
      <Panel
        data-tour="sync-now"
        aria-labelledby="now-title"
        className="flex flex-wrap items-start gap-x-6 gap-y-3 p-4 text-sm"
      >
        <div className="flex min-w-56 flex-1 flex-col gap-2">
          <h2 id="now-title" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Сейчас
          </h2>
          {runs ? <Now runs={runs} /> : <Skeleton className="h-5 w-64" />}
          {schedule && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Следующий запуск</dt>
              <dd>
                <NextRun schedule={schedule} running={running} />
              </dd>
              <dt className="text-muted-foreground">Планировщик</dt>
              <dd>{SCHEDULER[schedule.state]}</dd>
            </dl>
          )}
        </div>
        <Button onClick={() => trigger.mutate()} disabled={busy || !runs}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          {busy ? 'Идёт синхронизация…' : 'Синхронизировать сейчас'}
        </Button>
      </Panel>

      <div role="status" aria-live="polite">
        {streamStatus === 'reconnecting' && (
          <Notice tone="info" Icon={WifiOff} title="Нет связи для обновлений в реальном времени">
            <span>
              Итог запуска появится после переподключения. Чтобы не ждать, перечитайте журнал кнопкой «Обновить».
            </span>
          </Notice>
        )}
      </div>

      <Panel aria-labelledby="runs-title">
        <PanelHeader
          tourTarget="sync-runs"
          title="История запусков"
          titleId="runs-title"
          meta={<span className="text-xs text-muted-foreground">от новых к старым</span>}
        >
          <Button variant="outline" size="sm" disabled={runsQuery.isFetching} onClick={() => void runsQuery.refetch()}>
            <RefreshCw className={cn(runsQuery.isRefetching && 'animate-spin')} aria-hidden="true" />
            Обновить
          </Button>
        </PanelHeader>

        {!runs && runsQuery.isError && (
          <LoadError
            title="Не удалось загрузить журнал"
            error={runsQuery.error}
            onRetry={() => void runsQuery.refetch()}
          />
        )}
        {!runs && !runsQuery.isError && <TableSkeleton label="Загрузка журнала" columns={COLUMNS} rows={6} />}
        {runs?.length === 0 && (
          <EmptyState Icon={History} title="Запусков ещё не было">
            Первый запуск выполняется при старте сервиса, следующие — по расписанию или кнопкой выше.
          </EmptyState>
        )}
        {runs && runs.length > 0 && (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Запуски синхронизации: время, длительность, триггер, статус, сохранено цен, попыток, кредитов, ошибка
                </caption>
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className={TH}>
                      №
                    </th>
                    <th scope="col" className={TH}>
                      Начало
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Длит.
                    </th>
                    <th scope="col" className={TH}>
                      Триггер
                    </th>
                    <th scope="col" className={TH}>
                      Статус
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Цен
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Попыток
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Кредитов
                    </th>
                    <th scope="col" className={TH}>
                      Ошибка
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} id={`run-${run.id}`} className={cn(ROW, run.id === highlighted && 'bg-info-bg')}>
                      <td className={`${TD} text-muted-foreground tabular-nums`}>#{run.id}</td>
                      <td className={TD}>
                        <Started run={run} />
                      </td>
                      <td className={`${TD} text-right`}>
                        <Duration run={run} />
                      </td>
                      <td className={TD}>{TRIGGER[run.trigger]}</td>
                      <td className={TD}>
                        <SyncStatusBadge status={run.status} />
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {run.pricesSaved}/{run.coinsRequested}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{run.attempts}</td>
                      <td className={`${TD} text-right tabular-nums`}>{run.creditsUsed ?? '—'}</td>
                      <td className={`${TD} max-w-64`}>
                        <RunError run={run} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y lg:hidden" aria-label="Запуски синхронизации">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className={cn(
                    'flex animate-row-in flex-col gap-1.5 px-4 py-3 text-sm transition-colors duration-(--duration-base)',
                    run.id === highlighted && 'bg-info-bg',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="tabular-nums">#{run.id}</strong>
                    <SyncStatusBadge status={run.status} />
                    <span className="ml-auto text-xs text-muted-foreground">
                      <Started run={run} />
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {TRIGGER[run.trigger]} · <Duration run={run} /> · цен {run.pricesSaved}/{run.coinsRequested} ·
                    попыток {run.attempts} · кредитов {run.creditsUsed ?? '—'}
                  </span>
                  {run.error && <RunError run={run} />}
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3 border-t px-4 py-3">
              {runsQuery.hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runsQuery.fetchNextPage()}
                  disabled={runsQuery.isFetchingNextPage}
                >
                  {runsQuery.isFetchingNextPage && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                  {runsQuery.isFetchingNextPage ? 'Загрузка…' : 'Загрузить ещё'}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Это все запуски</span>
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
