'use client';

import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from 'cn';
import { Input } from './input';

/**
 * Поле пароля с кнопкой показа внутри. Кнопка — переключатель (`aria-pressed`) с постоянным именем «Показать
 * пароль»: скринридер объявляет «нажата / не нажата», имя при этом не меняется. Она стоит после поля в порядке
 * Tab и не отправляет форму. Сам пароль в разметку подсказок и атрибутов не попадает.
 */
export function PasswordInput({ className, id, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={shown ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
      <button
        type="button"
        aria-label="Показать пароль"
        aria-pressed={shown}
        aria-controls={id}
        onClick={() => setShown((value) => !value)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors duration-(--duration-fast) outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:text-foreground"
      >
        {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
