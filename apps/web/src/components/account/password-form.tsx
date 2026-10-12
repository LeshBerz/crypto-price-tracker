'use client';

import { useMutation } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, fieldDescribedBy } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { account } from '@/lib/account/client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/account/contract';
import { describeAccountFailure, parsePasswordForm, problemSlug, type PasswordFields } from '@/lib/account/forms';

/** Сервер уже отозвал сессию и стёр cookie: остаётся перейти на вход. Полный переход сбрасывает кэш запросов */
export function toLogin(): void {
  window.location.assign('/login');
}

const FIELDS = [
  { name: 'currentPassword', autoComplete: 'current-password' },
  { name: 'newPassword', autoComplete: 'new-password' },
  { name: 'repeat', autoComplete: 'new-password' },
] as const;

/**
 * Смена своего пароля (ui-flows §3.4). Текущий пароль обязателен: одной открытой сессии для смены мало.
 * После смены сервер отзывает все сессии — форма сразу ведёт на вход. Та же форма стоит на экране
 * обязательной смены временного пароля: там «текущий» — пароль, выданный оператором.
 */
export function PasswordForm({ login, currentLabel = 'Текущий пароль' }: { login: string; currentLabel?: string }) {
  const id = useId();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const [fields, setFields] = useState<PasswordFields>({});
  const [failure, setFailure] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: account.changePassword,
    onSuccess: toLogin,
    onError: (error) => {
      const text = describeAccountFailure(error);
      if (problemSlug(error) === 'invalid-current-password') setFields({ currentPassword: text });
      else setFailure(text);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (change.isPending) return;
    setFailure(null);
    const parsed = parsePasswordForm(values);
    if (!parsed.ok) return setFields(parsed.fields);
    setFields({});
    change.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword });
  };

  const labels = { currentPassword: currentLabel, newPassword: 'Новый пароль', repeat: 'Новый пароль ещё раз' };
  return (
    <form onSubmit={submit} noValidate className="flex max-w-sm flex-col gap-3">
      {/* Скрытое поле логина — подсказка менеджеру паролей, к какой учётной записи относится новый пароль */}
      <input type="text" name="username" value={login} autoComplete="username" readOnly hidden />
      {FIELDS.map(({ name, autoComplete }) => {
        const fieldId = `${id}-${name}`;
        return (
          <Field
            key={name}
            id={fieldId}
            label={labels[name]}
            error={fields[name]}
            hint={name === 'newPassword' ? `Не короче ${PASSWORD_MIN_LENGTH} символов` : undefined}
            info={
              name === 'newPassword'
                ? {
                    label: 'Требования к паролю',
                    text: 'Требований к составу нет: длина защищает лучше, чем обязательные цифры и знаки. Подойдёт фраза из нескольких слов или пароль из менеджера паролей.',
                  }
                : undefined
            }
          >
            <PasswordInput
              id={fieldId}
              name={name}
              value={values[name]}
              onChange={(event) => {
                setValues((old) => ({ ...old, [name]: event.target.value }));
                setFields((old) => ({ ...old, [name]: undefined }));
              }}
              autoComplete={autoComplete}
              maxLength={PASSWORD_MAX_LENGTH}
              aria-invalid={fields[name] ? true : undefined}
              aria-describedby={fieldDescribedBy(fieldId)}
            />
          </Field>
        );
      })}
      <span role="alert" className="text-sm text-destructive empty:hidden">
        {failure}
      </span>
      <div className="flex flex-col gap-2">
        <Button type="submit" className="self-start" disabled={change.isPending}>
          {change.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {change.isPending ? 'Сохранение…' : 'Сменить пароль'}
        </Button>
        {/* Последствие действия — на виду, а не за значком: его нужно знать до нажатия */}
        <span className="text-xs text-muted-foreground">После смены все сессии завершатся — нужно войти заново.</span>
      </div>
    </form>
  );
}
