'use client';

import type { ReactElement, ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from 'cn';

const POPUP =
  'z-[70] max-w-72 origin-(--transform-origin) rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background shadow-md transition-[opacity,scale] duration-(--duration-fast) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0';

/** Общая задержка: после первой подсказки соседние открываются сразу — курсор ведут вдоль строки таблицы */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={350} closeDelay={80}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/**
 * Подсказка вместо атрибута `title`: одинаковый вид в обеих темах, открывается и по фокусу, закрывается по Esc.
 * Содержимое подсказки вторично: всё, без чего экран не понять, остаётся в тексте. На сенсорном экране подсказка
 * не открывается — для пояснений, которые нужны и там, есть `InfoHint`.
 */
export function Hint({
  text,
  children,
  side = 'top',
  className,
}: {
  text: ReactNode;
  /** Один элемент: на него вешаются обработчики и `aria-describedby` */
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  if (text === null || text === undefined || text === '') return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-[70]">
          <TooltipPrimitive.Popup data-slot="tooltip" className={cn(POPUP, className)}>
            {text}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
