'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActivePath, type NavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/** Активный пункт — маркер снизу (решение Q11) и aria-current: цвет не единственный сигнал */
export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Основная навигация" className="flex h-full items-stretch gap-1">
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center border-b-2 px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
