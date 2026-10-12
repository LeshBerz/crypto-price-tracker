'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, MonitorSmartphone, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { LoadError } from '@/components/load-error';
import { Timestamp } from '@/components/timestamp';
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
import { InfoHint } from '@/components/ui/info-hint';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { FieldsSkeleton, TableSkeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { account } from '@/lib/account/client';
import type { SessionDto } from '@/lib/account/contract';
import { countSessions, describeAccountFailure, ROLE_HINTS, ROLE_LABELS } from '@/lib/account/forms';
import { applyOwnSessionRevoked, profileQuery, refreshAccount } from '@/lib/account/queries';
import { useNow } from '@/lib/dashboard/use-price-stream';
import { PasswordForm, toLogin } from './password-form';
import { SessionsTable } from './sessions-table';

const SESSION_COLUMNS = [
  { width: 'w-32' },
  { width: 'w-20' },
  { width: 'w-28' },
  { width: 'w-20' },
  { width: 'w-20', right: true },
];

/** Заголовок блока со значком: три блока профиля читаются как разделы одного экрана */
function SectionTitle({ Icon, id, children }: { Icon: typeof KeyRound; id: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary-soft text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span id={id}>{children}</span>
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-h-6 items-center gap-1.5 text-sm">{children}</dd>
    </div>
  );
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
        <Panel>
          <LoadError
            title="Не удалось загрузить профиль"
            error={profile.error}
            onRetry={() => void profile.refetch()}
          />
        </Panel>
      )}
      {!data && !profile.isError && (
        <>
          <Panel className="p-4">
            <FieldsSkeleton label="Загрузка учётной записи" />
          </Panel>
          <Panel>
            <TableSkeleton label="Загрузка сессий" columns={SESSION_COLUMNS} rows={2} />
          </Panel>
        </>
      )}

      {data && (
        <>
          <Panel aria-labelledby="account-title">
            <PanelHeader
              title={
                <SectionTitle Icon={UserRound} id="account-title">
                  Учётная запись
                </SectionTitle>
              }
            />
            <dl className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-3">
              <Fact label="Логин">
                <span className="font-mono font-semibold">{data.login}</span>
              </Fact>
              <Fact label="Роль">
                <Badge variant="secondary">{ROLE_LABELS[data.role]}</Badge>
                <InfoHint label="Что может роль">{ROLE_HINTS[data.role]}. Роль назначает оператор.</InfoHint>
              </Fact>
              <Fact label="Последний вход">{data.lastLoginAt ? <Timestamp iso={data.lastLoginAt} /> : '—'}</Fact>
            </dl>
          </Panel>

          <Panel aria-labelledby="my-sessions-title">
            <PanelHeader
              title={
                <SectionTitle Icon={MonitorSmartphone} id="my-sessions-title">
                  Мои сессии
                </SectionTitle>
              }
              meta={<Badge variant="secondary">{countSessions(data.sessions.length)}</Badge>}
            >
              <Button
                variant="destructive"
                size="sm"
                disabled={logoutAll.isPending}
                onClick={() => setConfirming(true)}
              >
                <LogOut aria-hidden="true" />
                Выйти на всех устройствах
              </Button>
            </PanelHeader>
            <SessionsTable
              sessions={data.sessions}
              now={now}
              showLogin={false}
              busyId={revoke.isPending ? revoke.variables.id : null}
              actionLabel="Завершить"
              onRevoke={(session) => revoke.mutate(session)}
            />
          </Panel>

          <Panel aria-labelledby="password-title">
            <PanelHeader
              title={
                <SectionTitle Icon={KeyRound} id="password-title">
                  Смена пароля
                </SectionTitle>
              }
            />
            <div className="p-4">
              <PasswordForm login={data.login} />
            </div>
          </Panel>

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
