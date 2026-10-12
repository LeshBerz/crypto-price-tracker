import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OperatorNav } from '@/components/operator/operator-nav';
import { getCurrentSession } from '@/server/current-session';
import { hasRole } from '@/server/bff/allowlist';

/**
 * Разделы оператора. Роль проверяется на сервере дважды: здесь — чтобы Viewer не получил разметку экрана,
 * и в BFF на каждом запросе данных (allowlist) — чтобы не получил сами данные. Скрытый пункт меню — удобство,
 * а не защита (ui-flows §1).
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const { session } = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasRole(session.role, 'operator')) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-2 rounded-xl bg-card px-4 py-12 text-center text-sm ring-1 ring-foreground/10"
      >
        <ShieldAlert className="size-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Недостаточно прав</h1>
        <p className="text-muted-foreground">Этот раздел доступен только оператору.</p>
        <Link href="/" className="mt-2 font-medium text-primary underline underline-offset-2">
          ← К дашборду
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Панель оператора</h1>
        <p className="text-sm text-muted-foreground">
          Управление watchlist, синхронизацией и пользователями, состояние интеграции с CoinMarketCap
        </p>
      </div>
      <OperatorNav />
      {children}
    </div>
  );
}
