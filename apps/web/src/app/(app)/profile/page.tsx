import type { Metadata } from 'next';
import { ProfilePanel } from '@/components/account/profile-panel';

export const metadata: Metadata = { title: 'Профиль' };

export default function ProfilePage() {
  return <ProfilePanel />;
}
