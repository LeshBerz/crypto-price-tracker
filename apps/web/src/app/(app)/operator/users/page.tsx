import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { UsersPanel } from '@/components/account/users-panel';
import { getCurrentSession } from '@/server/current-session';

export const metadata: Metadata = { title: 'Пользователи' };

/** Логин текущего пользователя нужен экрану, чтобы пометить свою строку и предупредить о потере своей сессии */
export default async function UsersPage() {
  const { session } = await getCurrentSession();
  if (!session) redirect('/login');
  return <UsersPanel currentLogin={session.login} />;
}
