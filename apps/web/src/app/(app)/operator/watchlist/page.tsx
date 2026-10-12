import type { Metadata } from 'next';
import { WatchlistPanel } from '@/components/operator/watchlist-panel';

export const metadata: Metadata = { title: 'Watchlist' };

export default function WatchlistPage() {
  return <WatchlistPanel />;
}
