import type { ReactNode } from 'react';
import { cn } from 'cn';
import { InfoHint } from './info-hint';
import { Label } from './label';

/**
 * Строка подписи одной высоты у всех полей: кнопка формы в одном ряду с полем выравнивается по нему этим
 * отступом. На узком экране кнопка переносится под поля и занимает всю ширину — отступ там не нужен.
 */
export const FIELD_LABEL_OFFSET = 'max-sm:w-full sm:mt-6.5';

/**
 * Поле формы: подпись, необязательное пояснение за значком «i», сам элемент ввода, требование к вводу и ошибка.
 * Требование (`hint`) видно до ввода, ошибка встаёт на его место и объявляется скринридеру (`role="alert"`).
 * Элемент ввода связывается с ними сам: `aria-describedby={fieldDescribedBy(id)}`.
 */
export function Field({
  id,
  label,
  optional = false,
  info,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  optional?: boolean;
  /** Вторичное пояснение «почему так» — прячется за значок */
  info?: { label: string; text: ReactNode };
  /** Требование к вводу — остаётся на виду */
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="field" className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex h-5 items-center gap-1.5">
        <Label htmlFor={id}>
          {label}
          {optional && <span className="font-normal text-muted-foreground">(необязательно)</span>}
        </Label>
        {info && <InfoHint label={info.label}>{info.text}</InfoHint>}
      </div>
      {children}
      {/* При ошибке требование не дублируется: текст ошибки сам говорит, что исправить */}
      {hint && !error && (
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      )}
      <span id={`${id}-error`} role="alert" className="text-xs text-destructive empty:hidden">
        {error}
      </span>
    </div>
  );
}

export function fieldDescribedBy(id: string): string {
  return `${id}-hint ${id}-error`;
}
