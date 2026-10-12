'use client';

import type { ReactNode } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Info } from 'lucide-react';
import { cn } from 'cn';

/**
 * Значок «i» с пояснением. Это кнопка с всплывающим блоком, а не подсказка по наведению: открывается нажатием,
 * касанием и с клавиатуры (Enter, пробел), закрывается по Esc и нажатию вне блока. За значок убирается только
 * вторичный текст — «почему так»; требования к вводу остаются видимыми у поля (WCAG 3.3.2).
 */
export function InfoHint({
  label,
  children,
  className,
}: {
  /** О чём пояснение — имя кнопки для скринридера, например «Что такое CMC ID» */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        aria-label={label}
        data-slot="info-hint"
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--duration-fast) outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-primary-soft data-popup-open:text-primary',
          // Цель нажатия 24 × 24 px при значке 20 px (WCAG 2.5.8)
          'relative after:absolute after:-inset-0.5',
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="top" sideOffset={6} collisionPadding={12} className="z-[70]">
          <PopoverPrimitive.Popup
            data-slot="info-hint-popup"
            className="max-w-[min(20rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-lg bg-popover px-3 py-2.5 text-xs leading-relaxed font-normal text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-[opacity,scale] duration-(--duration-fast) outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
