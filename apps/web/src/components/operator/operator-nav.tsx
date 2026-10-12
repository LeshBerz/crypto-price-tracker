'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActivePath, OPERATOR_SECTIONS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/** Разделы панели оператора — отдельные адреса: ссылка на раздел открывает его сразу и переживает обновление страницы */
export function OperatorNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы оператора" className="flex flex-wrap gap-1 border-b">
      {OPERATOR_SECTIONS.map((section) => {
        const active = isActivePath(pathname, section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
