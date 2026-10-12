import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/dashboard/dashboard';
import { getCurrentSession } from '@/server/current-session';

export const metadata: Metadata = { title: 'Дашборд' };

/** Данные экран запрашивает из браузера через BFF; сервер передаёт только роль — для текстов пустого состояния */
export default async function DashboardPage() {
  const { session } = await getCurrentSession();
  if (!session) redirect('/login');
  return <Dashboard role={session.role} />;
}
