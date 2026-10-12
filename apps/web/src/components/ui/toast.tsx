'use client';

import type { ReactNode } from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { CircleCheck, CircleX, Info, X, type LucideIcon } from 'lucide-react';
import { cn } from 'cn';

export type ToastTone = 'success' | 'error' | 'info';

/** Очередь уведомлений вне дерева React: её вызывают обработчики мутаций, а показывает `Toaster` в layout */
const manager = ToastPrimitive.createToastManager();

/** Ошибка остаётся на экране дольше: её нужно успеть прочитать и, возможно, переписать идентификатор запроса */
const TIMEOUT: Record<ToastTone, number> = { success: 5000, info: 6000, error: 10_000 };

function show(tone: ToastTone, title: string, description?: ReactNode): string {
  return manager.add({
    type: tone,
    title,
    description,
    timeout: TIMEOUT[tone],
    // Ошибку скринридер зачитывает сразу (assertive), остальное — когда договорит (polite)
    priority: tone === 'error' ? 'high' : 'low',
  });
}

export const toast = {
  success: (title: string, description?: ReactNode) => show('success', title, description),
  error: (title: string, description?: ReactNode) => show('error', title, description),
  info: (title: string, description?: ReactNode) => show('info', title, description),
};

const TONE: Record<ToastTone, { Icon: LucideIcon; className: string }> = {
  success: { Icon: CircleCheck, className: 'text-up' },
  error: { Icon: CircleX, className: 'text-destructive' },
  info: { Icon: Info, className: 'text-info' },
};

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((item) => {
    const { Icon, className } = TONE[(item.type as ToastTone | undefined) ?? 'info'] ?? TONE.info;
    return (
      <ToastPrimitive.Root
        key={item.id}
        toast={item}
        data-slot="toast"
        className="flex items-start gap-3 rounded-lg bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
      >
        <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden="true" />
        <ToastPrimitive.Content className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ToastPrimitive.Title className="font-semibold" />
          <ToastPrimitive.Description className="text-muted-foreground" />
        </ToastPrimitive.Content>
        <ToastPrimitive.Close
          aria-label="Закрыть уведомление"
          className="rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-4" aria-hidden="true" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Root>
    );
  });
}

/** Область уведомлений: правый нижний угол, не больше трёх одновременно. Объявление для скринридера — в Viewport */
export function Toaster() {
  return (
    <ToastPrimitive.Provider toastManager={manager} limit={3}>
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          data-slot="toast-viewport"
          className="fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none"
        >
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}
