'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from 'cn';

export type SelectOption<Value extends string> = { value: Value; label: string; description?: string };

/**
 * Выбор одного значения из короткого списка. Клавиатура — как у нативного списка: стрелки, Home/End, набор
 * первых букв, Esc. Кнопка связана с подписью через `id` + `<label htmlFor>`; значение уходит в форму
 * скрытым полем `name`.
 */
export function Select<Value extends string>({
  id,
  name,
  value,
  onValueChange,
  options,
  className,
  'aria-describedby': describedBy,
}: {
  id: string;
  name?: string;
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly SelectOption<Value>[];
  className?: string;
  'aria-describedby'?: string;
}) {
  return (
    <SelectPrimitive.Root
      name={name}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as Value);
      }}
      items={options}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-describedby={describedBy}
        data-slot="select-trigger"
        className={cn(
          'flex h-9 w-full min-w-36 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors duration-(--duration-fast) outline-none select-none hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:border-ring dark:bg-input/30',
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="text-muted-foreground transition-transform duration-(--duration-base) data-popup-open:rotate-180">
          <ChevronDown className="size-4" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          sideOffset={4}
          align="end"
          collisionPadding={12}
          alignItemWithTrigger={false}
          className="z-[70]"
        >
          <SelectPrimitive.Popup
            data-slot="select-popup"
            className="max-w-[calc(100vw-1.5rem)] min-w-(--anchor-width) origin-(--transform-origin) rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-[opacity,scale] duration-(--duration-fast) outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="grid cursor-default grid-cols-[1rem_1fr] items-start gap-x-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              >
                <SelectPrimitive.ItemIndicator className="col-start-1 mt-0.5">
                  <Check className="size-4 text-primary" aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
                <span className="col-start-2 flex flex-col">
                  <SelectPrimitive.ItemText className="font-medium">{option.label}</SelectPrimitive.ItemText>
                  {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
