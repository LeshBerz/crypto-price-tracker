'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleCheck, KeyRound, LoaderCircle, ShieldCheck, ShieldMinus, UserCheck, UserPlus } from 'lucide-react';
import { useId, useState, type ComponentProps, type FormEvent } from 'react';
import { LoadError } from '@/components/load-error';
import { Timestamp } from '@/components/timestamp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FIELD_LABEL_OFFSET, fieldDescribedBy } from '@/components/ui/field';
import { InfoHint } from '@/components/ui/info-hint';
import { Input } from '@/components/ui/input';
import { Panel, PanelHeader, ROW, TD, TH } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
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
import { plural } from '@/lib/format';
import { SessionsTable } from './sessions-table';
import { ConfirmUserDialog, IssuedPasswordDialog, type IssuedPassword, type UserAction } from './user-dialogs';

const USERS = ['пользователь', 'пользователя', 'пользователей'] as const;
const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role], description: ROLE_HINTS[role] }));
const USER_COLUMNS = [
  { width: 'w-28' },
  { width: 'w-16' },
  { width: 'w-20' },
  { width: 'w-24' },
  { width: 'w-6', right: true },
  { width: 'w-64', right: true },
];
const SESSION_COLUMNS = [
  { width: 'w-20' },
  { width: 'w-32' },
  { width: 'w-20' },
  { width: 'w-28' },
  { width: 'w-20' },
  { width: 'w-20', right: true },
];

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
  return <Timestamp iso={user.lastLoginAt} format="relative" now={now} className="text-muted-foreground" />;
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
      <Field
        id={`${id}-login`}
        label="Логин"
        className="min-w-56 flex-1"
        info={{
          label: 'Откуда берётся пароль',
          text: 'Пароль создаёт сервер и показывает один раз после создания. При первом входе пользователь обязан его сменить.',
        }}
        hint="Латинские буквы, цифры, точка, дефис, подчёркивание; от 3 до 32 символов"
        error={error}
      >
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
          aria-describedby={fieldDescribedBy(`${id}-login`)}
          className="font-mono"
        />
      </Field>
      {/* Что может каждая роль, написано в самом списке — отдельной строки под полем нет */}
      <Field id={`${id}-role`} label="Роль" className="max-sm:flex-1">
        <Select id={`${id}-role`} name="role" value={role} onValueChange={setRole} options={ROLE_OPTIONS} />
      </Field>
      <Button type="submit" className={FIELD_LABEL_OFFSET} disabled={create.isPending}>
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

/**
 * Кнопка действия в строке. Если действие запрещено правилом (последний оператор, свой пароль), кнопка остаётся
 * в порядке Tab и объясняет причину подсказкой: у обычной отключённой кнопки нет ни фокуса, ни наведения.
 */
function ActionButton({
  reason,
  disabled,
  variant = 'outline',
  ...props
}: Omit<ComponentProps<typeof Button>, 'size'> & { reason: string | null }) {
  const button = (
    <Button variant={variant} size="sm" disabled={disabled} focusableWhenDisabled={reason !== null} {...props} />
  );
  return reason === null ? button : <Hint text={reason}>{button}</Hint>;
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
      <ActionButton
        disabled={busy || (isOperator && locked !== null)}
        reason={isOperator ? locked : null}
        onClick={() => onAction(isOperator ? 'demote' : 'promote')}
        aria-label={`${isOperator ? `Перевести в ${ROLE_LABELS.viewer}` : 'Сделать оператором'}: ${user.login}`}
      >
        {isOperator ? <ShieldMinus aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        {isOperator ? `В ${ROLE_LABELS.viewer}` : `В ${ROLE_LABELS.operator}`}
      </ActionButton>
      <ActionButton
        disabled={busy || isSelf}
        reason={isSelf ? 'Свой пароль меняется в профиле' : null}
        onClick={() => onAction('reset')}
        aria-label={`Сбросить пароль: ${user.login}`}
      >
        <KeyRound aria-hidden="true" />
        Сбросить пароль
      </ActionButton>
      {user.isActive ? (
        <ActionButton
          variant="destructive"
          disabled={busy || locked !== null}
          reason={locked}
          onClick={() => onAction('disable')}
          aria-label={`Отключить: ${user.login}`}
        >
          <Ban aria-hidden="true" />
          Отключить
        </ActionButton>
      ) : (
        <ActionButton disabled={busy} reason={null} onClick={onEnable} aria-label={`Включить: ${user.login}`}>
          <UserCheck aria-hidden="true" />
          Включить
        </ActionButton>
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
      <Panel aria-labelledby="create-title" className="flex flex-col gap-3 p-4">
        <h2 id="create-title" className="font-semibold">
          Создать пользователя
        </h2>
        <CreateUserForm onCreated={setIssued} />
      </Panel>

      <Panel aria-labelledby="users-title">
        <PanelHeader
          title="Пользователи"
          titleId="users-title"
          meta={
            items && (
              <Badge variant="secondary">
                {items.length} {plural(items.length, USERS)}
              </Badge>
            )
          }
        />

        {!items && users.isError && (
          <LoadError
            title="Не удалось загрузить пользователей"
            error={users.error}
            onRetry={() => void users.refetch()}
          />
        )}
        {!items && !users.isError && <TableSkeleton label="Загрузка пользователей" columns={USER_COLUMNS} rows={3} />}
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
                    <tr key={user.id} className={ROW}>
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
                      <td className={`${TD} text-right tabular-nums`}>{user.activeSessions}</td>
                      <td className={TD}>{actions(user)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y md:hidden" aria-label="Пользователи">
              {items.map((user) => (
                <li key={user.id} className="flex animate-row-in flex-col gap-2 px-4 py-3 text-sm">
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
      </Panel>

      <Panel aria-labelledby="sessions-title">
        <PanelHeader
          title="Активные сессии"
          titleId="sessions-title"
          meta={
            <>
              {sessionItems && <Badge variant="secondary">{countSessions(sessionItems.length)}</Badge>}
              <InfoHint label="Сколько живёт сессия">
                Сессия завершается после 2 часов бездействия и не живёт дольше 12 часов. Отозванная сессия теряет доступ
                сразу; открытая вкладка с потоком событий — в течение 25 секунд, на ближайшей проверке.
              </InfoHint>
            </>
          }
        />
        {!sessionItems && sessions.isError && (
          <LoadError
            title="Не удалось загрузить сессии"
            error={sessions.error}
            onRetry={() => void sessions.refetch()}
          />
        )}
        {!sessionItems && !sessions.isError && (
          <TableSkeleton label="Загрузка сессий" columns={SESSION_COLUMNS} rows={2} />
        )}
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
      </Panel>

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
