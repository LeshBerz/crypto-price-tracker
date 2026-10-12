import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { PROFILE_HREF } from '@/lib/navigation';
import { getCurrentSession } from '@/server/current-session';
import { TemporaryPasswordForm } from './temporary-password-form';

export const metadata: Metadata = { title: 'Смена временного пароля' };

/**
 * Обязательная смена временного пароля (ADR 0016, поправка 35). Экран стоит вне основной оболочки: навигации
 * и данных здесь нет, потому что с временным паролем сервер их всё равно не отдаст. Обычная смена пароля —
 * в профиле.
 */
export default async function PasswordPage() {
  const { session, hadCookie } = await getCurrentSession();
  if (!session) redirect(hadCookie ? '/login?reason=expired' : '/login');
  if (!session.mustChangePassword) redirect(PROFILE_HREF);

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <div className="flex justify-end p-3">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-12">
        <main className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-5 flex flex-col items-center gap-3 text-center">
            <LogoMark size={44} />
            <h1 className="text-lg font-semibold tracking-tight">Задайте свой пароль</h1>
            <p className="text-sm text-muted-foreground">
              Вы вошли как <strong className="font-mono font-semibold text-foreground">{session.login}</strong> с
              паролем, который выдал оператор. Он временный: работа начнётся после смены.
            </p>
          </div>
          <TemporaryPasswordForm login={session.login} />
          <p className="mt-5 flex items-start justify-center gap-2 text-center text-xs text-muted-foreground">
            <KeyRound aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Временный пароль известен оператору. Новый будет знать только его владелец: в базе хранится хэш.
          </p>
        </main>
      </div>
    </div>
  );
}
