'use client';

import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import type { UserDto } from '@/lib/account/contract';
import { countSessions, ROLE_LABELS } from '@/lib/account/forms';

export type UserAction = 'promote' | 'demote' | 'disable' | 'reset';

const TITLES: Record<UserAction, (login: string) => string> = {
  promote: (login) => `Сделать ${login} оператором?`,
  demote: (login) => `Перевести ${login} в ${ROLE_LABELS.viewer}?`,
  disable: (login) => `Отключить ${login}?`,
  reset: (login) => `Сбросить пароль ${login}?`,
};

const EFFECTS: Record<UserAction, string> = {
  promote: 'Пользователь сможет управлять watchlist, синхронизацией и другими пользователями.',
  demote: 'Пользователь сохранит доступ к ценам и графикам, но потеряет панель оператора.',
  disable: 'Пользователь не сможет войти, пока его не включат снова. Учётная запись и логин сохраняются.',
  reset: 'Текущий пароль перестанет действовать. Новый временный пароль будет показан один раз.',
};

const CONFIRM: Record<UserAction, [idle: string, pending: string]> = {
  promote: ['Сделать оператором', 'Сохранение…'],
  demote: [`Перевести в ${ROLE_LABELS.viewer}`, 'Сохранение…'],
  disable: ['Отключить', 'Отключение…'],
  reset: ['Сбросить пароль', 'Сброс…'],
};

function sessionsEffect(user: UserDto, isSelf: boolean): ReactNode {
  if (isSelf) {
    return (
      <>
        <strong className="text-foreground">Это ваша учётная запись:</strong> все ваши сессии будут завершены, и
        потребуется войти заново.
      </>
    );
  }
  if (user.activeSessions === 0) return 'Действующих сессий у пользователя нет.';
  return (
    <>
      У пользователя{' '}
      <strong className="text-foreground">
        {user.activeSessions === 1 ? 'будет завершена' : 'будут завершены'} {countSessions(user.activeSessions)}
      </strong>
      : открытые вкладки потеряют доступ в течение 25 секунд.
    </>
  );
}

/**
 * Подтверждение действия над пользователем (ui-flows §3.8, §5): что изменится и сколько сессий завершится.
 * Монтируется с `key`: состояние не переживает смену пользователя. `pending` — запрос идёт, диалог не закрыть.
 */
export function ConfirmUserDialog({
  user,
  action,
  isSelf,
  pending,
  onConfirm,
  onClose,
}: {
  user: UserDto;
  action: UserAction;
  isSelf: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [idle, busy] = CONFIRM[action];
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogTitle>{TITLES[action](user.login)}</DialogTitle>
        <DialogDescription>
          {EFFECTS[action]} {sessionsEffect(user, isSelf)}
        </DialogDescription>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Отмена</DialogClose>
          <Button
            type="button"
            variant={action === 'promote' ? 'default' : 'destructive'}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? busy : idle}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type IssuedPassword = { login: string; password: string; reason: 'created' | 'reset' };

/**
 * Временный пароль показывается один раз: сервер хранит только хэш и повторно его не отдаст. Поэтому диалог
 * не закрывается кликом мимо — только кнопкой. Пароль живёт в состоянии экрана и исчезает вместе с диалогом.
 */
export function IssuedPasswordDialog({ issued, onClose }: { issued: IssuedPassword; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      // Буфер обмена недоступен (нет разрешения или небезопасный контекст): пароль можно выделить вручную
      setCopied(false);
    }
  };

  return (
    <Dialog open disablePointerDismissal onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>
          {issued.reason === 'created' ? `Пользователь ${issued.login} создан` : `Пароль ${issued.login} сброшен`}
        </DialogTitle>
        <DialogDescription>
          Передайте пользователю временный пароль. После входа его можно сменить в профиле.
        </DialogDescription>
        <div className="flex items-center gap-2">
          <code
            className="min-w-0 flex-1 rounded-lg border bg-muted px-3 py-2 font-mono text-base break-all select-all"
            aria-label="Временный пароль"
          >
            {issued.password}
          </code>
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
        </div>
        <span role="status" className="text-xs text-destructive empty:hidden">
          {copied === false && 'Скопировать не удалось: выделите пароль и скопируйте вручную.'}
        </span>
        <Notice tone="warn" Icon={TriangleAlert} title="Пароль показан один раз">
          <span>После закрытия окна увидеть его нельзя — только сбросить заново.</span>
        </Notice>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Пароль сохранён
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
