import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppFooter } from '@/components/app-footer';
import { AppHeader } from '@/components/app-header';
import { QueryProvider } from '@/components/query-provider';
import { StreamProvider } from '@/components/stream-provider';
import { getCurrentSession } from '@/server/current-session';

/** Всё внутри группы (app) — только после входа. Проверка — в БД на каждый запрос, а не по наличию cookie */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { session, hadCookie } = await getCurrentSession();
  if (!session) redirect(hadCookie ? '/login?reason=expired' : '/login');

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
      >
        К содержимому
      </a>
      <AppHeader login={session.login} role={session.role} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <QueryProvider>
          <StreamProvider>{children}</StreamProvider>
        </QueryProvider>
      </main>
      <AppFooter />
    </div>
  );
}
