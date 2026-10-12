import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppFooter } from '@/components/app-footer';
import { AppHeader } from '@/components/app-header';
import { QueryProvider } from '@/components/query-provider';
import { StreamProvider } from '@/components/stream-provider';
import { TourProvider } from '@/components/tour/tour-provider';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PASSWORD_CHANGE_HREF } from '@/lib/navigation';
import { getServices } from '@/server/container';
import { getCurrentSession } from '@/server/current-session';

/** Всё внутри группы (app) — только после входа. Проверка — в БД на каждый запрос, а не по наличию cookie */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { session, hadCookie } = await getCurrentSession();
  if (!session) redirect(hadCookie ? '/login?reason=expired' : '/login');
  // Вход с временным паролем: единственный доступный экран — смена пароля
  if (session.mustChangePassword) redirect(PASSWORD_CHANGE_HREF);

  // Отметки гида читаются вместе со страницей: отдельного запроса из браузера нет, гид не открывается дважды
  const completedTours = getServices().tours.completed(session.userId);

  return (
    <TourProvider role={session.role} completed={completedTours}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
        >
          К содержимому
        </a>
        <AppHeader login={session.login} role={session.role} />
        {/* Футер показывает состояние системы из того же кэша запросов, поэтому стоит внутри провайдеров */}
        <QueryProvider>
          <StreamProvider>
            <TooltipProvider>
              <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
                {children}
              </main>
              <AppFooter role={session.role} />
            </TooltipProvider>
          </StreamProvider>
        </QueryProvider>
        <Toaster />
      </div>
    </TourProvider>
  );
}
