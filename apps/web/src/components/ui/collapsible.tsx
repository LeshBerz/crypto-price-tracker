'use client';

import type { ReactNode } from 'react';
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { ChevronRight } from 'lucide-react';
import { cn } from 'cn';

/**
 * Раскрывающийся блок: кнопка с шевроном и панель, высота которой анимируется. Состояние задаёт родитель:
 * форма открывает блок сама, когда в скрытом поле появилась ошибка, — иначе сообщение осталось бы невидимым.
 * Кнопка несёт `aria-expanded` и `aria-controls` (их ставит Base UI).
 */
export function Collapsible({
  label,
  open,
  onOpenChange,
  children,
  className,
}: {
  label: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={onOpenChange} data-slot="collapsible" className={className}>
      <CollapsiblePrimitive.Trigger className="group -ml-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-sm font-medium text-muted-foreground transition-colors duration-(--duration-fast) outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-panel-open:text-foreground">
        <ChevronRight
          className="size-4 transition-transform duration-(--duration-base) ease-(--ease-out) group-data-panel-open:rotate-90"
          aria-hidden="true"
        />
        {label}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Panel
        className={cn(
          'h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-(--duration-base) ease-(--ease-out)',
          'data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0',
        )}
      >
        {/* Отступ внутри панели, а не снаружи: иначе высота «прыгает» в конце анимации. p-1 — место для кольца фокуса */}
        <div className="-mx-1 px-1 pt-2 pb-1">{children}</div>
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
