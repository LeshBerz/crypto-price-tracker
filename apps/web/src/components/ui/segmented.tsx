'use client';

import { cn } from 'cn';
import { Hint } from './tooltip';

export type SegmentedOption<Value extends string> = {
  value: Value;
  label: string;
  /** Почему вариант недоступен: кнопка остаётся в порядке Tab и объясняет причину подсказкой */
  disabledReason?: string | null;
};

/**
 * Сегментированный переключатель: один из нескольких вариантов, все на виду. Это группа кнопок-переключателей
 * (`aria-pressed`), а не вкладки: содержимое под ним не меняется целиком, меняется параметр.
 */
export function Segmented<Value extends string>({
  labelledBy,
  value,
  onChange,
  options,
  onBlocked,
  className,
}: {
  /** id элемента с подписью группы */
  labelledBy: string;
  value: Value;
  onChange: (value: Value) => void;
  options: readonly SegmentedOption<Value>[];
  /** Нажат недоступный вариант: экран может показать причину строкой — на сенсорном экране подсказки нет */
  onBlocked?: (reason: string) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      data-slot="segmented"
      className={cn('inline-flex gap-0.5 rounded-lg bg-muted p-0.5 ring-1 ring-foreground/5', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        const reason = option.disabledReason ?? null;
        const disabled = reason !== null;
        const button = (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-disabled={disabled || undefined}
            onClick={() => (reason === null ? onChange(option.value) : onBlocked?.(reason))}
            className={cn(
              'h-7 min-w-9 rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-(--duration-fast) outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50',
              active
                ? 'bg-background text-foreground shadow-sm ring-1 ring-foreground/10'
                : 'text-muted-foreground hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-45 hover:text-muted-foreground',
            )}
          >
            {option.label}
          </button>
        );
        return reason === null ? (
          button
        ) : (
          <Hint key={option.value} text={reason}>
            {button}
          </Hint>
        );
      })}
    </div>
  );
}
