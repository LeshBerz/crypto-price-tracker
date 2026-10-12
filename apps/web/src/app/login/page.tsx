import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { getCurrentSession } from '@/server/current-session';
import { LoginForm } from './login-form';
import { LoginTour } from './login-tour';

export const metadata: Metadata = { title: 'Вход' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { session } = await getCurrentSession();
  if (session) redirect('/');
  const { reason } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <div className="flex items-center justify-end gap-1 p-3">
        <LoginTour />
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-12">
        <main className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-5 flex flex-col items-center gap-3 text-center">
            <LogoMark size={44} />
            <h1 className="text-lg font-semibold tracking-tight">Вход в Crypto Price Tracker</h1>
            <p className="text-sm text-muted-foreground">
              Точные цены криптовалют из CoinMarketCap. Доступ — по учётной записи от оператора.
            </p>
          </div>
          <LoginForm expired={reason === 'expired'} />
          <p
            data-tour="login-no-signup"
            className="mt-5 flex items-start justify-center gap-2 text-center text-xs text-muted-foreground"
          >
            <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Нет доступа или забыли пароль — обратитесь к оператору: самостоятельной регистрации нет.
          </p>
        </main>
      </div>
    </div>
  );
}
