import { LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Timestamp } from '@/components/timestamp';
import { Button } from '@/components/ui/button';
import { ROW, TD, TH } from '@/components/ui/panel';
import { Hint } from '@/components/ui/tooltip';
import type { SessionDto } from '@/lib/account/contract';
import { describeUserAgent } from '@/lib/account/forms';

function Browser({ session }: { session: SessionDto }) {
  return (
    <Hint text={session.userAgent}>
      <span>{describeUserAgent(session.userAgent)}</span>
    </Hint>
  );
}

function Activity({ session, now }: { session: SessionDto; now: number }) {
  return <Timestamp iso={session.lastSeenAt} format="relative" now={now} />;
}

/**
 * Таблица действующих сессий — общая для профиля и экрана оператора. Текущую сессию отсюда не завершить:
 * для неё есть «Выйти» в меню пользователя, а случайный клик не должен выбрасывать из приложения.
 */
export function SessionsTable({
  sessions,
  now,
  showLogin,
  busyId,
  actionLabel,
  onRevoke,
}: {
  sessions: readonly SessionDto[];
  now: number;
  /** Экран оператора показывает, чья сессия; в профиле все сессии свои */
  showLogin: boolean;
  busyId: string | null;
  actionLabel: string;
  onRevoke: (session: SessionDto) => void;
}) {
  const action = (session: SessionDto) =>
    session.isCurrent ? (
      <Badge variant="secondary">текущая</Badge>
    ) : (
      <Button
        variant="outline"
        size="sm"
        disabled={busyId !== null}
        onClick={() => onRevoke(session)}
        aria-label={`${actionLabel} сессию ${showLogin ? `${session.login}, ` : ''}${describeUserAgent(session.userAgent)}`}
      >
        <LogOut aria-hidden="true" />
        {busyId === session.id ? 'Завершение…' : actionLabel}
      </Button>
    );

  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Действующие сессии: когда создана, последняя активность, адрес, браузер</caption>
          <thead>
            <tr className="border-b text-left">
              {showLogin && (
                <th scope="col" className={TH}>
                  Пользователь
                </th>
              )}
              <th scope="col" className={TH}>
                Браузер
              </th>
              <th scope="col" className={TH}>
                IP
              </th>
              <th scope="col" className={TH}>
                Создана
              </th>
              <th scope="col" className={TH}>
                Активность
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className={ROW}>
                {showLogin && <td className={`${TD} font-semibold`}>{session.login}</td>}
                <td className={TD}>
                  <Browser session={session} />
                </td>
                <td className={`${TD} font-mono text-muted-foreground tabular-nums`}>{session.ip ?? '—'}</td>
                <td className={`${TD} text-muted-foreground`}>
                  <Timestamp iso={session.createdAt} />
                </td>
                <td className={`${TD} text-muted-foreground`}>
                  <Activity session={session} now={now} />
                </td>
                <td className={`${TD} text-right`}>{action(session)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y md:hidden" aria-label="Действующие сессии">
        {sessions.map((session) => (
          <li key={session.id} className="flex animate-row-in items-start justify-between gap-3 px-4 py-3 text-sm">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="font-semibold">
                {showLogin && `${session.login} · `}
                <Browser session={session} />
              </div>
              <div className="text-xs text-muted-foreground">
                Создана <Timestamp iso={session.createdAt} /> · активность <Activity session={session} now={now} />
                {session.ip && ` · ${session.ip}`}
              </div>
            </div>
            {action(session)}
          </li>
        ))}
      </ul>
    </>
  );
}
