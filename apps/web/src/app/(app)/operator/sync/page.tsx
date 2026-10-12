import type { Metadata } from 'next';
import { SyncPanel } from '@/components/operator/sync-panel';

export const metadata: Metadata = { title: 'Синхронизация' };

export default function SyncPage() {
  return <SyncPanel />;
}
