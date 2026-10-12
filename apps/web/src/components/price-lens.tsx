'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Copy, Crosshair, X } from 'lucide-react';
import { cn } from 'cn';
import { Timestamp } from '@/components/timestamp';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { formatPrice, plural } from '@/lib/format';
import { lensView, type LensDigit } from '@/lib/price-lens';

/** Скрытые цифры проявляются по очереди: шаг задержки между соседними */
const REVEAL_STEP_MS = 35;
const REVEAL_START_MS = 120;
const HIDDEN_DIGITS = ['цифра скрыта', 'цифры скрыты', 'цифр скрыто'] as const;

function Digit({ digit }: { digit: LensDigit }) {
  return (
    <span
      className={cn(
        'inline-block',
        digit.groupStart && 'ml-[0.35em]',
        digit.leadingZero && 'font-medium text-muted-foreground',
        digit.hidden && 'rounded-xs bg-primary-soft text-primary motion-safe:animate-lens-reveal',
      )}
      style={
        digit.hidden
          ? ({ animationDelay: `${REVEAL_START_MS + digit.hiddenIndex * REVEAL_STEP_MS}ms` } as CSSProperties)
          : undefined
      }
    >
      {digit.char}
    </span>
  );
}

async function copyExact(price: string): Promise<void> {
  try {
    // В незащищённом контексте (http не на localhost) `navigator.clipboard` отсутствует
    await navigator.clipboard.writeText(price);
    toast.success('Скопировано', price);
  } catch {
    toast.error('Не удалось скопировать', 'Браузер не дал доступ к буферу обмена: выделите значение вручную.');
  }
}

export type PriceLensProps = {
  /** Цена строкой из api, без округления */
  price: string;
  currency: string;
  symbol?: string;
  sourceUpdatedAt: string;
  fetchedAt: string;
  isStale?: boolean;
  /** Оформление кнопки: цвет устаревшей цены, вспышка изменения */
  className?: string;
  /** Округлённая цена — то, что видно в таблице */
  children: ReactNode;
};

/**
 * «Линза точности»: цена на экране — кнопка, по нажатию открывается строка из api целиком. Цифры, срезанные
 * округлением, подсвечены и проявляются по очереди. Всплывающий блок — Base UI `Popover`: позиционирование,
 * закрытие по Esc и нажатию вне блока, возврат фокуса на цену — от примитива (ADR 0018).
 */
export function PriceLens({
  price,
  currency,
  symbol,
  sourceUpdatedAt,
  fetchedAt,
  isStale = false,
  className,
  children,
}: PriceLensProps) {
  const copyRef = useRef<HTMLButtonElement>(null);
  const { integer, fraction, significant, shown } = lensView(price);
  const hiddenCount = significant - shown;

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        data-slot="price-lens"
        className={cn(
          '-mx-1 cursor-zoom-in rounded px-1 font-mono tabular-nums decoration-transparent decoration-dotted underline-offset-4 outline-none hover:underline hover:decoration-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-primary-soft',
          className,
        )}
      >
        {children}
        <span className="sr-only">{isStale ? ', устарела' : ''}. Показать точное значение</span>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="bottom" sideOffset={8} collisionPadding={12} className="z-[70]">
          <PopoverPrimitive.Popup
            data-slot="price-lens-popup"
            initialFocus={copyRef}
            className="flex w-[min(22.5rem,calc(100vw-1.5rem))] origin-(--transform-origin) flex-col gap-2.5 rounded-xl bg-popover p-3.5 text-left text-sm font-normal text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-[opacity,scale] duration-(--duration-base) outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <div className="flex items-center gap-2">
              <PopoverPrimitive.Title className="flex items-center gap-1.5 text-sm font-semibold">
                <Crosshair className="size-4 text-primary" aria-hidden="true" />
                Точная цена{symbol ? ` ${symbol}` : ''}
              </PopoverPrimitive.Title>
              <PopoverPrimitive.Close
                aria-label="Закрыть"
                className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" aria-hidden="true" />
              </PopoverPrimitive.Close>
            </div>

            {/* Скринридер читает строку из api целиком; разбивка на группы и подсветка — только для глаз */}
            <p
              data-slot="price-lens-digits"
              aria-label={`${price} ${currency}`}
              className="rounded-lg bg-surface px-2.5 py-2 font-mono text-xl leading-snug font-bold wrap-anywhere"
            >
              <span aria-hidden="true">
                ${integer}
                {fraction.length > 0 && '.'}
                {fraction.map((digit, index) => (
                  <Digit key={index} digit={digit} />
                ))}
              </span>
            </p>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
              <dt className="text-muted-foreground">В интерфейсе</dt>
              <dd className="font-mono tabular-nums">{formatPrice(price)}</dd>
              <dt className="text-muted-foreground">Значащих цифр</dt>
              <dd>
                {significant} — показано {shown}
                {hiddenCount > 0 && (
                  <>
                    , ещё <strong>{hiddenCount}</strong> {plural(hiddenCount, HIDDEN_DIGITS)} округлением
                  </>
                )}
              </dd>
              <dt className="text-muted-foreground">Котировка CMC</dt>
              <dd>
                <Timestamp iso={sourceUpdatedAt} format="clock" seconds />
              </dd>
              <dt className="text-muted-foreground">Получено сервисом</dt>
              <dd>
                <Timestamp iso={fetchedAt} format="clock" seconds />
              </dd>
            </dl>

            <PopoverPrimitive.Description className="text-xs leading-relaxed text-muted-foreground">
              Строка из API без преобразования в число: ни одна цифра CoinMarketCap не потеряна.
            </PopoverPrimitive.Description>

            <div>
              <Button ref={copyRef} variant="outline" size="sm" onClick={() => void copyExact(price)}>
                <Copy aria-hidden="true" />
                Скопировать точное значение
              </Button>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
