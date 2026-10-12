import { cn } from 'cn';

/** Заглушка на месте текста или блока, пока идёт первая загрузка */
export function Skeleton({ className }: { className?: string }) {
  return <span data-slot="skeleton" className={cn('block h-4 animate-pulse rounded bg-skeleton', className)} />;
}

/**
 * Заглушка таблицы по форме будущего содержимого: столько колонок и такой ширины, как у настоящей. На узком
 * экране таблицы превращаются в карточки — заглушка тоже: две строки текста и ряд кнопок.
 * Сама заглушка скрыта от скринридера; о загрузке сообщает `aria-busy` и подпись контейнера.
 */
export function TableSkeleton({
  label,
  columns,
  rows = 4,
}: {
  /** Что загружается — подпись для скринридера, например «Загрузка пользователей» */
  label: string;
  /** Ширина заглушки в каждой колонке (класс Tailwind: `w-24`); `right` — колонка выровнена вправо */
  columns: readonly { width: string; right?: boolean }[];
  rows?: number;
}) {
  const lines = Array.from({ length: rows }, (_, index) => index);
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <div className="hidden md:block" aria-hidden="true">
        <div className="flex gap-4 border-b px-4 py-2.5">
          {columns.map((column, index) => (
            <div key={index} className={cn('flex flex-1', column.right && 'justify-end')}>
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
        {lines.map((line) => (
          <div key={line} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0">
            {columns.map((column, index) => (
              <div key={index} className={cn('flex flex-1', column.right && 'justify-end')}>
                <Skeleton className={column.width} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <ul className="divide-y md:hidden" aria-hidden="true">
        {lines.map((line) => (
          <li key={line} className="flex flex-col gap-2.5 px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="w-32" />
              <Skeleton className="w-20" />
            </div>
            <Skeleton className="h-3 w-44" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Заглушка списка «подпись — значение» */
export function FieldsSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-6" aria-hidden="true">
          <Skeleton className="w-24" />
          <Skeleton className="w-40" />
        </div>
      ))}
    </div>
  );
}
