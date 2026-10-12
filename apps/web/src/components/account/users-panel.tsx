'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleCheck, KeyRound, LoaderCircle, ShieldCheck, ShieldMinus, UserCheck, UserPlus } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { PriceTableSkeleton } from '@/components/dashboard/price-table';
import { LoadError } from '@/components/load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { account } from '@/lib/account/client';
import { ROLES, type Role, type SessionDto, type UpdateUserRequest, type UserDto } from '@/lib/account/contract';
import {
  countSessions,
  describeAccountFailure,
  lockReason,
  parseLogin,
  ROLE_HINTS,
  ROLE_LABELS,
} from '@/lib/account/forms';
import { applySessionRevoked, applyUserSaved, refreshAccount, sessionsQuery, usersQuery } from '@/lib/account/queries';
import { useNow } from '@/lib/dashboard/use-price-stream';
import { formatRelative, plural } from '@/lib/format';
import { SessionsTable } from './sessions-table';
import { ConfirmUserDialog, IssuedPasswordDialog, type IssuedPassword, type UserAction } from './user-dialogs';

const TH = 'px-4 py-2 text-xs font-medium text-muted-foreground';
const TD = 'px-4 py-3 align-middle';
const CARD = 'overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10';
const USERS = ['пользователь', 'пользователя', 'пользователей'] as const;
const SELECT =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30';

type Opened = { action: UserAction; id: number };
type Change = { user: UserDto; body: UpdateUserRequest };

const BODY: Record<Exclude<UserAction, 'reset'>, UpdateUserRequest> = {
  promote: { role: 'operator' },
  demote: { role: 'viewer' },
  disable: { isActive: false },
};

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="bg-up-bg text-up">
      <CircleCheck aria-hidden="true" />
      активен
    </Badge>
  ) : (
    <Badge variant="secondary">
      <Ban aria-hidden="true" />
      отключён
    </Badge>
  );
}

function LastLogin({ user, now }: { user: UserDto; now: number }) {
  if (!user.lastLoginAt) return <span className="text-muted-foreground">не входил</span>;
  return (
    <time dateTime={user.lastLoginAt} title={`${user.lastLoginAt} (UTC)`} className="text-muted-foreground">
      {formatRelative(user.lastLoginAt, now)}
    </time>
  );
}

/**
 * Создание пользователя. Пароля в форме нет: его создаёт сервер и показывает один раз — оператор не выбирает
 * слабый пароль и не знает постоянного (ADR 0016, поправка 29).
 */
function CreateUserForm({ onCreated }: { onCreated: (issued: IssuedPassword) => void }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: account.createUser,
    onSuccess: ({ user, temporaryPassword }) => {
      applyUserSaved(queryClient, user);
      setLogin('');
      setRole('viewer');
      onCreated({ login: user.login, password: temporaryPassword, reason: 'created' });
    },
    // Ошибка формы показывается у поля, а не уведомлением: она про то, что введено
    onError: (failure) => setError(describeAccountFailure(failure)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    const parsed = parseLogin(login);
    if (!parsed.ok) return setError(parsed.message);
    setError(null);
    create.mutate({ login: parsed.login, role });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-3">
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <Label htmlFor={`${id}-login`}>Логин</Label>
        <Input
          id={`${id}-login`}
          name="login"
          value={login}
          onChange={(event) => {
            setLogin(event.target.value);
            setError(null);
          }}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={32}
          placeholder="например, ivan.petrov"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-login-hint ${id}-login-error`}
          className="font-mono"
        />
        <span id={`${id}-login-hint`} className="text-xs text-muted-foreground">
          Латинские буквы, цифры, точка, дефис, подчёркивание; от 3 до 32 символов.
        </span>
        <span id={`${id}-login-error`} role="alert" className="text-xs text-destructive empty:hidden">
          {error}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-role`}>Роль</Label>
        <select
          id={`${id}-role`}
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          aria-describedby={`${id}-role-hint`}
          className={SELECT}
        >
          {ROLES.map((item) => (
            <option key={item} value={item}>
              {ROLE_LABELS[item]}
            </option>
          ))}
        </select>
        <span id={`${id}-role-hint`} className="max-w-64 text-xs text-muted-foreground">
          {ROLE_HINTS[role]}
        </span>
      </div>
      <Button type="submit" className="sm:mt-5.5" disabled={create.isPending}>
        {create.isPending ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <UserPlus aria-hidden="true" />
        )}
        {create.isPending ? 'Создание…' : 'Создать'}
      </Button>
    </form>
  );
}

function UserActions({
  user,
  locked,
  isSelf,
  busy,
  onAction,
  onEnable,
}: {
  user: UserDto;
  /** Причина, по которой пользователя нельзя понизить или отключить; `null` — можно */
  locked: string | null;
  isSelf: boolean;
  busy: boolean;
  onAction: (action: UserAction) => void;
  onEnable: () => void;
}) {
  const isOperator = user.role === 'operator';
  return (
    <div className="flex flex-wrap gap-1.5 md:justify-end">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || (isOperator && locked !== null)}
        title={isOperator ? (locked ?? undefined) : undefined}
        onClick={() => onAction(isOperator ? 'demote' : 'promote')}
        aria-label={`${isOperator ? `Перевести в ${ROLE_LABELS.viewer}` : 'Сделать оператором'}: ${user.login}`}
      >
        {isOperator ? <ShieldMinus aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        {isOperator ? `В ${ROLE_LABELS.viewer}` : `В ${ROLE_LABELS.operator}`}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || isSelf}
        title={isSelf ? 'Свой пароль меняется в профиле' : undefined}
        onClick={() => onAction('reset')}
        aria-label={`Сбросить пароль: ${user.login}`}
      >
        <KeyRound aria-hidden="true" />
        Сбросить пароль
      </Button>
      {user.isActive ? (
        <Button
          variant="destructive"
          size="sm"
          disabled={busy || locked !== null}
          title={locked ?? undefined}
          onClick={() => onAction('disable')}
          aria-label={`Отключить: ${user.login}`}
        >
          <Ban aria-hidden="true" />
          Отключить
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={busy} onClick={onEnable} aria-label={`Включить: ${user.login}`}>
          <UserCheck aria-hidden="true" />
          Включить
        </Button>
      )}
    </div>
  );
}

/**
 * Пользователи и сессии (ui-flows §3.8). Данные — из web.db через `/api/admin/*`, в api экран не ходит.
 * Событий потока по ним нет, поэтому кэш меняется из ответа мутации; то, чего в ответе нет (список сессий
 * после смены роли, счётчики после отзыва), перечитывается. Оптимистичных обновлений нет.
 */
export function UsersPanel({ currentLogin }: { currentLogin: string }) {
  const queryClient = useQueryClient();
  const users = useQuery(usersQuery(account));
  const sessions = useQuery(sessionsQuery(account));
  const now = useNow();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [issued, setIssued] = useState<IssuedPassword | null>(null);

  const failed = (title: string) => (error: unknown) => {
    toast.error(title, describeAccountFailure(error));
    setOpened(null);
    // 404 и 409 значат, что список на экране устарел: перечитывается всё, что показано
    refreshAccount(queryClient);
  };

  const change = useMutation({
    mutationFn: ({ user, body }: Change) => account.updateUser(user.id, body),
    onSuccess: ({ user, revokedSessions }) => {
      applyUserSaved(queryClient, user, revokedSessions);
      setOpened(null);
      // Изменены свои права: сервер завершил и эту сессию — дальше только вход
      if (user.login === currentLogin && revokedSessions > 0) return window.location.assign('/login');
      const tail = revokedSessions > 0 ? `Завершено: ${countSessions(revokedSessions)}.` : undefined;
      if (!user.isActive) toast.success(`${user.login} отключён`, tail);
      else toast.success(`${user.login}: ${ROLE_LABELS[user.role]}, активен`, tail);
    },
    onError: (error, { user }) => failed(`${user.login}: изменение не сохранено`)(error),
  });

  const reset = useMutation({
    mutationFn: (user: UserDto) => account.resetPassword(user.id),
    onSuccess: ({ user, temporaryPassword, revokedSessions }) => {
      applyUserSaved(queryClient, user, revokedSessions);
      setOpened(null);
      setIssued({ login: user.login, password: temporaryPassword, reason: 'reset' });
    },
    onError: (error, user) => failed(`${user.login}: пароль не сброшен`)(error),
  });

  const revoke = useMutation({
    mutationFn: (session: SessionDto) => account.revokeSession(session.id),
    onSuccess: (_, session) => {
      applySessionRevoked(queryClient, session.id);
      toast.success(
        `Сессия ${session.login} завершена`,
        'Открытая вкладка потеряет доступ в течение 25 секунд — на ближайшей проверке потока событий.',
      );
    },
    onError: (error, session) => failed(`Сессия ${session.login} не завершена`)(error),
  });

  const items = users.data?.items;
  const sessionItems = sessions.data?.items;
  const busyId = change.isPending ? change.variables.user.id : reset.isPending ? reset.variables.id : null;
  const openedUser = opened ? items?.find((user) => user.id === opened.id) : undefined;

  const confirm = (user: UserDto, action: UserAction) =>
    action === 'reset' ? reset.mutate(user) : change.mutate({ user, body: BODY[action] });

  const actions = (user: UserDto) => (
    <UserActions
      user={user}
      locked={items ? lockReason(user, items) : null}
      isSelf={user.login === currentLogin}
      busy={busyId === user.id}
      onAction={(action) => setOpened({ action, id: user.id })}
      onEnable={() => change.mutate({ user, body: { isActive: true } })}
    />
  );
  const name = (user: UserDto) => (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono font-semibold">{user.login}</span>
      {user.login === currentLogin && <Badge variant="outline">это вы</Badge>}
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="create-title" className={`${CARD} flex flex-col gap-3 p-4`}>
        <h2 id="create-title" className="font-semibold">
          Создать пользователя
        </h2>
        <CreateUserForm onCreated={setIssued} />
      </section>

      <section aria-labelledby="users-title" className={CARD}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
          <h2 id="users-title" className="font-semibold">
            Пользователи
          </h2>
          {items && (
            <Badge variant="secondary">
              {items.length} {plural(items.length, USERS)}
            </Badge>
          )}
        </div>

        {!items && users.isError && (
          <LoadError
            title="Не удалось загрузить пользователей"
            error={users.error}
            onRetry={() => void users.refetch()}
          />
        )}
        {!items && !users.isError && <PriceTableSkeleton />}
        {items && (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Пользователи: роль, статус, последний вход, сессии, действия</caption>
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className={TH}>
                      Логин
                    </th>
                    <th scope="col" className={TH}>
                      Роль
                    </th>
                    <th scope="col" className={TH}>
                      Статус
                    </th>
                    <th scope="col" className={TH}>
                      Последний вход
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Сессий
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user.id} className="border-b last:border-b-0">
                      <td className={TD}>{name(user)}</td>
                      <td className={TD}>
                        <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
                      </td>
                      <td className={TD}>
                        <StatusBadge active={user.isActive} />
                      </td>
                      <td className={TD}>
                        <LastLogin user={user} now={now} />
                      </td>
                      <td className={`${TD} text-right font-mono tabular-nums`}>{user.activeSessions}</td>
                      <td className={TD}>{actions(user)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y md:hidden" aria-label="Пользователи">
              {items.map((user) => (
                <li key={user.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    {name(user)}
                    <span className="flex gap-1.5">
                      <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
                      <StatusBadge active={user.isActive} />
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Последний вход: <LastLogin user={user} now={now} /> · {countSessions(user.activeSessions)}
                  </div>
                  {actions(user)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="sessions-title" className={CARD}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
          <h2 id="sessions-title" className="font-semibold">
            Активные сессии
          </h2>
          {sessionItems && <Badge variant="secondary">{countSessions(sessionItems.length)}</Badge>}
          <span className="ml-auto text-xs text-muted-foreground">бездействие 2 ч, не дольше 12 ч</span>
        </div>
        {!sessionItems && sessions.isError && (
          <LoadError
            title="Не удалось загрузить сессии"
            error={sessions.error}
            onRetry={() => void sessions.refetch()}
          />
        )}
        {!sessionItems && !sessions.isError && <PriceTableSkeleton />}
        {sessionItems && (
          <SessionsTable
            sessions={sessionItems}
            now={now}
            showLogin
            busyId={revoke.isPending ? revoke.variables.id : null}
            actionLabel="Отозвать"
            onRevoke={(session) => revoke.mutate(session)}
          />
        )}
      </section>

      {opened && openedUser && (
        <ConfirmUserDialog
          key={`${opened.action}-${openedUser.id}`}
          user={openedUser}
          action={opened.action}
          isSelf={openedUser.login === currentLogin}
          pending={change.isPending || reset.isPending}
          onConfirm={() => confirm(openedUser, opened.action)}
          onClose={() => setOpened(null)}
        />
      )}
      {issued && <IssuedPasswordDialog key={issued.password} issued={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}
