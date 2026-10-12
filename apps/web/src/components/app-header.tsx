import Link from 'next/link';
import { AppNav } from '@/components/app-nav';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { TourButton } from '@/components/tour/tour-provider';
import { UserMenu } from '@/components/user-menu';
import { navItemsFor } from '@/lib/navigation';
import type { Role } from '@/server/users';

export function AppHeader({ login, role }: { login: string; role: Role }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-stretch gap-2 px-4 sm:gap-4">
        <Link
          href="/"
          aria-label="Crypto Price Tracker — на дашборд"
          data-tour="logo"
          className="flex items-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        <AppNav items={navItemsFor(role)} />
        <div className="ml-auto flex items-center gap-1">
          <TourButton />
          <ThemeToggle />
          <UserMenu login={login} role={role} />
        </div>
      </div>
    </header>
  );
}
