'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { LoadError } from '@/components/load-error';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { bff } from '@/lib/bff-client';
import { useNow } from '@/lib/dashboard/use-price-stream';
import { formatCount, formatDate, formatDateTime, formatInterval, formatRelative } from '@/lib/format';
import {
  cmcStatusQuery,
  mergeRunPages,
  readinessQuery,
  syncRunsQuery,
  type CmcStatus,
  type Readiness,
} from '@/lib/operator/queries';
import {
  averageCreditsPerRun,
  cmcAvailability,
  forecastQuota,
  quotaPercent,
  readSchedule,
  type CmcQuota,
  type QuotaForecast,
  type Schedule,
} from '@/lib/operator/system';
import { cn } from '@/lib/utils';

type Tone = 'ok' | 'warn' | 'error' | 'neutral';

const TONE: Record<Tone, { className: string; Icon: LucideIcon | null }> = {
  ok: { className: 'bg-up-bg text-up', Icon: CircleCheck },
  warn: { className: 'bg-warn-bg text-warn', Icon: TriangleAlert },
  error: { className: 'bg-error-bg text-destructive', Icon: CircleX },
  neutral: { className: 'bg-secondary text-secondary-foreground', Icon: null },
};

function State({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { className, Icon } = TONE[tone];
  return (
    <Badge className={className}>
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </Badge>
  );
}

const CARD = 'rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10';
const SKELETON = 'inline-block h-4 w-32 animate-pulse rounded bg-skeleton';

function Tile({ title, state, hint }: { title: string; state: ReactNode; hint: ReactNode }) {
  return (
    <div className={cn(CARD, 'flex flex-col gap-1.5')}>
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</span>
      <span>{state}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

function Time({ iso, now }: { iso: string; now: number }) {
  return (
    <>
      <time dateTime={iso} title={`${iso} (UTC)`} className="font-mono tabular-nums">
        {formatDateTime(iso, { seconds: true })}
      </time>{' '}
      <span className="text-muted-foreground">({formatRelative(iso, now)})</span>
    </>
  );
}

const DL = 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-2';
const DT = 'text-muted-foreground';

function CmcSection({ cmc, schedule, now }: { cmc: CmcStatus; schedule: Schedule | null; now: number }) {
  return (
    <section aria-labelledby="cmc-title" className={cn(CARD, 'flex flex-col gap-3')}>
      <h2 id="cmc-title" className="text-base font-semibold">
        Интеграция с CoinMarketCap
      </h2>
      <dl className={DL}>
        <dt className={DT}>Последний успех</dt>
        <dd>{cmc.lastSuccessAt ? <Time iso={cmc.lastSuccessAt} now={now} /> : 'ещё не было'}</dd>
        <dt className={DT}>Последняя ошибка</dt>
        <dd>
          {cmc.lastError ? (
            <span className="flex flex-col gap-0.5">
              <span>
                <code className="font-mono text-xs">{cmc.lastError.code}</code> ·{' '}
                <Time iso={cmc.lastError.at} now={now} />
              </span>
              <span className="text-muted-foreground">{cmc.lastError.message}</span>
            </span>
          ) : (
            'не было'
          )}
        </dd>
        {schedule && (
          <>
            <dt className={DT}>Расписание</dt>
            <dd>{formatInterval(schedule.intervalMs)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function Forecast({ forecast, quota }: { forecast: QuotaForecast; quota: CmcQuota }) {
  if (forecast.enough) {
    return (
      <span>
        при текущем интервале нужно ≈ {formatCount(forecast.needed)} до конца месяца —{' '}
        <strong className="text-up">хватит</strong>, запас ≈ {formatCount(quota.creditsLeftMonth - forecast.needed)}
      </span>
    );
  }
  return (
    <span>
      <strong className="text-warn">закончится ≈ {formatDate(forecast.runsOutAt ?? 0)}</strong> — раньше конца месяца.
      Увеличьте интервал синхронизации или уберите монеты
    </span>
  );
}

function QuotaSection({
  quota,
  forecast,
  now,
}: {
  quota: CmcQuota | null;
  forecast: QuotaForecast | null;
  now: number;
}) {
  const percent = quota ? quotaPercent(quota) : 0;
  const low = forecast ? !forecast.enough : percent >= 90;
  return (
    <section aria-labelledby="quota-title" className={cn(CARD, 'flex flex-col gap-3')}>
      <h2 id="quota-title" className="text-base font-semibold">
        Квота CoinMarketCap
      </h2>
      {!quota && (
        <p className="text-muted-foreground">
          Квота ещё не получена: CoinMarketCap <code className="font-mono text-xs">key/info</code> не запрашивался.
          Появится после первой успешной синхронизации.
        </p>
      )}
      {quota && (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span>Использовано за месяц</span>
              <strong className="ml-auto font-mono tabular-nums">
                {formatCount(quota.creditsUsedMonth)} / {formatCount(quota.creditLimitMonthly)}
              </strong>
              <span className="font-mono text-muted-foreground tabular-nums">({percent} %)</span>
            </div>
            <div
              role="progressbar"
              aria-label="Использование квоты за месяц"
              aria-valuemin={0}
              aria-valuemax={quota.creditLimitMonthly}
              aria-valuenow={quota.creditsUsedMonth}
              aria-valuetext={`${percent} процентов`}
              className="h-2 overflow-hidden rounded-full bg-secondary"
            >
              <div
                className={cn('h-full rounded-full', low ? 'bg-warn' : 'bg-primary')}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <dl className={DL}>
            <dt className={DT}>Осталось</dt>
            <dd className="font-mono tabular-nums">{formatCount(quota.creditsLeftMonth)} кредитов</dd>
            <dt className={DT}>Сегодня</dt>
            <dd className="font-mono tabular-nums">{formatCount(quota.creditsUsedToday)} кредитов</dd>
            {forecast && (
              <>
                <dt className={DT}>Прогноз</dt>
                <dd>
                  <Forecast forecast={forecast} quota={quota} />
                </dd>
              </>
            )}
            <dt className={DT}>Данные квоты</dt>
            <dd>
              по CoinMarketCap <code className="font-mono text-xs">key/info</code>,{' '}
              {formatRelative(quota.fetchedAt, now)}
            </dd>
          </dl>
        </>
      )}
    </section>
  );
}

const CHECK: Record<'ok' | 'fail', Tone> = { ok: 'ok', fail: 'error' };
const SCHEDULER: Record<Readiness['checks']['scheduler'], { tone: Tone; text: string }> = {
  running: { tone: 'ok', text: 'работает' },
  stopped: { tone: 'warn', text: 'остановлен' },
  disabled: { tone: 'neutral', text: 'выключен' },
};

function HealthSection({ readiness }: { readiness: Readiness }) {
  const { database, migrations, scheduler } = readiness.checks;
  return (
    <section aria-labelledby="health-title" className={cn(CARD, 'flex flex-col gap-3')}>
      <h2 id="health-title" className="text-base font-semibold">
        Здоровье сервиса <code className="font-mono text-xs font-normal text-muted-foreground">/health/ready</code>
      </h2>
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <dt>База данных</dt>
          <dd>
            <State tone={CHECK[database]}>{database === 'ok' ? 'отвечает' : 'не отвечает'}</State>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt>Миграции</dt>
          <dd>
            <State tone={CHECK[migrations]}>{migrations === 'ok' ? 'применены' : 'версия не совпадает'}</State>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt>Планировщик</dt>
          <dd>
            <State tone={SCHEDULER[scheduler].tone}>{SCHEDULER[scheduler].text}</State>
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Доступность CoinMarketCap в готовность не входит: при его отказе сервис отдаёт сохранённые цены (ADR 0014).
      </p>
    </section>
  );
}

/**
 * Система (ui-flows §3.7): состояние источника, квота и готовность api. Данные перечитываются по событию
 * `sync.finished` (каждая синхронизация меняет и журнал, и квоту) и кнопкой «Обновить»; опроса по таймеру нет.
 * Расписание и прогноз показываются, только если api отдаёт блок `schedule` (контракт 1.1.0, ADR 0017).
 */
export function SystemPanel() {
  const cmc = useQuery(cmcStatusQuery(bff));
  const readiness = useQuery(readinessQuery(bff));
  const runs = useInfiniteQuery(syncRunsQuery(bff));
  const now = useNow();

  const refresh = () => {
    void cmc.refetch();
    void readiness.refetch();
    void runs.refetch();
  };

  const availability = cmc.data ? cmcAvailability(cmc.data) : null;
  const schedule = readSchedule(cmc.data);
  const quota = cmc.data?.quota ?? null;
  const creditsPerRun = runs.data ? averageCreditsPerRun(mergeRunPages(runs.data.pages)) : null;
  // Планировщик остановлен — запусков не будет, и прогноз расхода не имеет смысла
  const forecast =
    quota && schedule?.state === 'running' && creditsPerRun !== null
      ? forecastQuota({ creditsLeftMonth: quota.creditsLeftMonth, intervalMs: schedule.intervalMs, creditsPerRun, now })
      : null;
  const ready = readiness.data?.status === 'ok';
  const fetching = cmc.isFetching || readiness.isFetching;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" disabled={fetching} onClick={refresh}>
          <RefreshCw className={cn(fetching && 'animate-spin')} aria-hidden="true" />
          Обновить
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile
          title="CoinMarketCap"
          state={
            availability === null ? (
              <span className={SKELETON} />
            ) : availability === 'available' ? (
              <State tone="ok">доступен</State>
            ) : availability === 'unavailable' ? (
              <State tone="error">недоступен</State>
            ) : (
              <State tone="neutral">нет данных</State>
            )
          }
          hint={
            cmc.data?.lastSuccessAt
              ? `последний успех ${formatRelative(cmc.data.lastSuccessAt, now)}`
              : 'успешных обращений ещё не было'
          }
        />
        <Tile
          title="Квота на месяц"
          state={
            !cmc.data ? (
              <span className={SKELETON} />
            ) : !quota ? (
              <State tone="neutral">нет данных</State>
            ) : forecast ? (
              forecast.enough ? (
                <State tone="ok">хватит</State>
              ) : (
                <State tone="warn">закончится раньше</State>
              )
            ) : (
              <State tone={quotaPercent(quota) >= 90 ? 'warn' : 'ok'}>использовано {quotaPercent(quota)} %</State>
            )
          }
          hint={
            quota
              ? `осталось ${formatCount(quota.creditsLeftMonth)} из ${formatCount(quota.creditLimitMonthly)} кредитов`
              : 'key/info ещё не запрашивался'
          }
        />
        <Tile
          title="Сервис"
          state={
            readiness.isError ? (
              <State tone="error">не отвечает</State>
            ) : !readiness.data ? (
              <span className={SKELETON} />
            ) : ready ? (
              <State tone="ok">готов</State>
            ) : (
              <State tone="error">не готов</State>
            )
          }
          hint="/health/ready: БД, миграции, планировщик"
        />
      </div>

      <div role="status" aria-live="polite">
        {availability === 'unavailable' && (
          <Notice tone="warn" Icon={TriangleAlert} title="Источник недоступен, сервис работает на сохранённых данных">
            <span>
              Дашборды показывают последние цены с пометкой «устарела». Готовность сервиса от CoinMarketCap не зависит —
              это штатная деградация. Синхронизация продолжает попытки по расписанию.
            </span>
          </Notice>
        )}
      </div>

      {cmc.isError && !cmc.data && (
        <div className={cn(CARD, 'p-0')}>
          <LoadError title="Не удалось загрузить состояние CoinMarketCap" error={cmc.error} onRetry={refresh} />
        </div>
      )}
      {cmc.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <CmcSection cmc={cmc.data} schedule={schedule} now={now} />
          <QuotaSection quota={quota} forecast={forecast} now={now} />
        </div>
      )}

      {readiness.isError && !readiness.data && (
        <div className={cn(CARD, 'p-0')}>
          <LoadError title="Не удалось проверить готовность сервиса" error={readiness.error} onRetry={refresh} />
        </div>
      )}
      {readiness.data && <HealthSection readiness={readiness.data} />}
    </div>
  );
}
