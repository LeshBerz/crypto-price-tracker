import type { ReactNode } from 'react';
import { ChangeValue, PriceText } from '@/components/dashboard/cells';
import type { AggregateStats } from '@/lib/coin/queries';

function Stat({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10" title={hint}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Сводка за период — поле `summary` ответа агрегатов: считает сервер, клиент только показывает */
export function CoinSummary({ summary }: { summary: AggregateStats | null }) {
  if (!summary) return <p className="text-sm text-muted-foreground">За период данных нет.</p>;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <Stat label="Открытие">
        <PriceText price={summary.open} />
      </Stat>
      <Stat label="Закрытие">
        <PriceText price={summary.close} />
      </Stat>
      <Stat label="Минимум">
        <PriceText price={summary.min} />
      </Stat>
      <Stat label="Максимум">
        <PriceText price={summary.max} />
      </Stat>
      <Stat label="Среднее" hint="Статистика: округлено до 10 значащих цифр">
        <PriceText price={summary.avg} />
      </Stat>
      <Stat label="Изменение">
        <ChangeValue change={summary.changePercent} />
      </Stat>
      <Stat label="Точек">
        <span className="font-mono tabular-nums">{summary.points.toLocaleString('ru-RU')}</span>
      </Stat>
    </dl>
  );
}

export function CoinSummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-busy="true" aria-label="Загрузка сводки">
      {Array.from({ length: 7 }, (_, index) => (
        <span key={index} className="h-14 animate-pulse rounded-lg bg-skeleton" />
      ))}
    </div>
  );
}
