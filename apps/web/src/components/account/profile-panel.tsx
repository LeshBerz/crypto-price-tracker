'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, LogOut } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { PriceTableSkeleton } from '@/components/dashboard/price-table';
import { LoadError } from '@/components/load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { account } from '@/lib/account/client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type SessionDto } from '@/lib/account/contract';
import {
  countSessions,
  describeAccountFailure,
  parsePasswordForm,
  problemSlug,
  ROLE_LABELS,
  type PasswordFields,
} from '@/lib/account/forms';
import { applyOwnSessionRevoked, profileQuery, refreshAccount } from '@/lib/account/queries';
import { useNow } from '@/lib/dashboard/use-price-stream';
import { formatDateTime } from '@/lib/format';
import { SessionsTable } from './sessions-table';

const CARD = 'overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10';

/** Сервер уже отозвал сессию и стёр cookie: остаётся перейти на вход. Полный переход сбрасывает кэш запросов */
function toLogin(): void {
  window.location.assign('/login');
}

function LogoutEverywhereDialog({
  count,
  pending,
  onConfirm,
  onClose,
}: {
  count: number;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogTitle>Выйти на всех устройствах?</DialogTitle>
        <DialogDescription>
          <strong className="text-foreground">
            {count === 1 ? 'Будет завершена' : 'Будут завершены'} {countSessions(count)}, включая текущую.
          </strong>{' '}
          На каждом устройстве потребуется войти заново; открытые вкладки потеряют доступ в течение 25 секунд.
        </DialogDescription>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Отмена</DialogClose>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? 'Выход…' : 'Выйти везде'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Смена своего пароля (ui-flows §3.4). Текущий пароль обязателен: одной открытой сессии для смены мало.
 * После смены сервер отзывает все сессии — форма сразу ведёт на вход.
 */
function PasswordForm({ login }: { login: string }) {
  const id = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
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
    const parsed = parsePasswordForm({ currentPassword, newPassword, repeat });
    if (!parsed.ok) return setFields(parsed.fields);
    setFields({});
    change.mutate({ currentPassword, newPassword });
  };

  const field = (
    name: keyof PasswordFields,
    label: string,
    value: string,
    setValue: (value: string) => void,
    autoComplete: string,
    hint?: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${name}`}>{label}</Label>
      <Input
        id={`${id}-${name}`}
        name={name}
        type="password"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setFields((old) => ({ ...old, [name]: undefined }));
        }}
        autoComplete={autoComplete}
        maxLength={PASSWORD_MAX_LENGTH}
        aria-invalid={fields[name] ? true : undefined}
        aria-describedby={`${id}-${name}-hint ${id}-${name}-error`}
      />
      {hint && (
        <span id={`${id}-${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      )}
      <span id={`${id}-${name}-error`} role="alert" className="text-xs text-destructive empty:hidden">
        {fields[name]}
      </span>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="flex max-w-sm flex-col gap-3">
      {/* Скрытое поле логина — подсказка менеджеру паролей, к какой учётной записи относится новый пароль */}
      <input type="text" name="username" value={login} autoComplete="username" readOnly hidden />
      {field('currentPassword', 'Текущий пароль', currentPassword, setCurrentPassword, 'current-password')}
      {field(
        'newPassword',
        'Новый пароль',
        newPassword,
        setNewPassword,
        'new-password',
        `Не короче ${PASSWORD_MIN_LENGTH} символов. Требований к составу нет: длина важнее.`,
      )}
      {field('repeat', 'Новый пароль ещё раз', repeat, setRepeat, 'new-password')}
      <span role="alert" className="text-sm text-destructive empty:hidden">
        {failure}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={change.isPending}>
          {change.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {change.isPending ? 'Сохранение…' : 'Сменить пароль'}
        </Button>
        <span className="text-xs text-muted-foreground">После смены все сессии завершатся — нужно войти заново.</span>
      </div>
    </form>
  );
}

/**
 * Профиль: кто вошёл, действующие сессии и смена пароля (ui-flows §3.4). Доступен любой роли.
 * Завершение сессии — ответ 204 без тела: строка убирается из кэша по факту успеха, без повторного чтения.
 */
export function ProfilePanel() {
  const queryClient = useQueryClient();
  const profile = useQuery(profileQuery(account));
  const now = useNow();
  const [confirming, setConfirming] = useState(false);

  const revoke = useMutation({
    mutationFn: (session: SessionDto) => account.revokeOwnSession(session.id),
    onSuccess: (_, session) => {
      applyOwnSessionRevoked(queryClient, session.id);
      toast.success('Сессия завершена', 'Вкладки на том устройстве потеряют доступ в течение 25 секунд.');
    },
    onError: (error) => {
      toast.error('Сессия не завершена', describeAccountFailure(error));
      refreshAccount(queryClient);
    },
  });

  const logoutAll = useMutation({
    mutationFn: account.logoutEverywhere,
    onSuccess: toLogin,
    onError: (error) => {
      toast.error('Выйти везде не удалось', describeAccountFailure(error));
      setConfirming(false);
    },
  });

  const data = profile.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Профиль</h1>
        <p className="text-sm text-muted-foreground">Учётная запись, действующие сессии и смена пароля</p>
      </div>

      {!data && profile.isError && (
        <div className={CARD}>
          <LoadError
            title="Не удалось загрузить профиль"
            error={profile.error}
            onRetry={() => void profile.refetch()}
          />
        </div>
      )}
      {!data && !profile.isError && (
        <div className={CARD}>
          <PriceTableSkeleton />
        </div>
      )}

      {data && (
        <>
          <section aria-labelledby="account-title" className={`${CARD} flex flex-col gap-3 p-4`}>
            <h2 id="account-title" className="font-semibold">
              Учётная запись
            </h2>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Логин</dt>
              <dd className="font-mono font-semibold">{data.login}</dd>
              <dt className="text-muted-foreground">Роль</dt>
              <dd>
                <Badge variant="secondary">{ROLE_LABELS[data.role]}</Badge>
              </dd>
              <dt className="text-muted-foreground">Последний вход</dt>
              <dd>
                {data.lastLoginAt ? (
                  <time dateTime={data.lastLoginAt} title={`${data.lastLoginAt} (UTC)`}>
                    {formatDateTime(data.lastLoginAt)}
                  </time>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          </section>

          <section aria-labelledby="my-sessions-title" className={CARD}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
              <h2 id="my-sessions-title" className="font-semibold">
                Мои сессии
              </h2>
              <Badge variant="secondary">{countSessions(data.sessions.length)}</Badge>
              <Button
                variant="destructive"
                size="sm"
                className="ml-auto"
                disabled={logoutAll.isPending}
                onClick={() => setConfirming(true)}
              >
                <LogOut aria-hidden="true" />
                Выйти на всех устройствах
              </Button>
            </div>
            <SessionsTable
              sessions={data.sessions}
              now={now}
              showLogin={false}
              busyId={revoke.isPending ? revoke.variables.id : null}
              actionLabel="Завершить"
              onRevoke={(session) => revoke.mutate(session)}
            />
          </section>

          <section aria-labelledby="password-title" className={`${CARD} flex flex-col gap-3 p-4`}>
            <h2 id="password-title" className="font-semibold">
              Смена пароля
            </h2>
            <PasswordForm login={data.login} />
          </section>

          {confirming && (
            <LogoutEverywhereDialog
              count={data.sessions.length}
              pending={logoutAll.isPending}
              onConfirm={() => logoutAll.mutate()}
              onClose={() => setConfirming(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
