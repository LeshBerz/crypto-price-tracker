import type { ComponentProps, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';

/** Блок экрана: подложка, тонкая обводка, один радиус на всех экранах */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="panel"
      className={cn('overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10', className)}
      {...props}
    />
  );
}

/** Шапка блока: заголовок, счётчик или метка рядом, действия справа */
export function PanelHeader({
  title,
  titleId,
  meta,
  children,
  className,
}: {
  title: ReactNode;
  titleId?: string;
  /** Счётчик или пояснение сразу после заголовка */
  meta?: ReactNode;
  /** Действия и вторичные сведения — прижаты вправо */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5', className)}>
      <h2 id={titleId} className="font-semibold">
        {title}
      </h2>
      {meta}
      {children && <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">{children}</div>}
    </div>
  );
}

/** Ячейки таблиц: один набор отступов и размер заголовков на всех экранах */
export const TH = 'px-4 py-2 text-xs font-medium text-muted-foreground';
export const TD = 'px-4 py-3 align-middle';
/** Строка таблицы и карточка списка: появление новой строки и подсветка под курсором */
export const ROW =
  'animate-row-in border-b transition-colors duration-(--duration-fast) last:border-b-0 hover:bg-muted/50';

/** Пустой список: что здесь будет и что сделать, чтобы оно появилось */
export function EmptyState({
  Icon,
  title,
  children,
  action,
}: {
  Icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div data-slot="empty-state" className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <strong className="font-semibold">{title}</strong>
        {children && <span className="text-muted-foreground">{children}</span>}
      </div>
      {action}
    </div>
  );
}
