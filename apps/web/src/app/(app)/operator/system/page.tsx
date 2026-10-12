import type { Metadata } from 'next';
import { SystemPanel } from '@/components/operator/system-panel';

export const metadata: Metadata = { title: 'Система' };

export default function SystemPage() {
  return <SystemPanel />;
}
