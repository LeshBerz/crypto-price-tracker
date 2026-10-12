'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { isActivePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';

type Box = { left: number; width: number };

/**
 * Навигация с маркером под активным пунктом (решение Q11). Маркер один и перетекает: при переходе — от прошлого
 * пункта к новому, при наведении и фокусе — к пункту под курсором, после ухода — обратно к активному.
 *
 * Положение считается после отрисовки (`useLayoutEffect`) и пересчитывается при изменении ширины
 * (`ResizeObserver`): подписи пунктов разной длины, а шрифт может загрузиться позже. До первого замера
 * активный пункт подчёркнут собственной рамкой — без скрипта и до гидратации навигация выглядит так же.
 * Смысл несёт `aria-current`, маркер — только оформление (`aria-hidden`).
 */
export function NavTabs({
  label,
  items,
  className,
  itemClassName,
  tourTarget,
}: {
  /** Имя навигации для скринридера: на странице их две */
  label: string;
  items: readonly { href: string; label: string }[];
  className?: string;
  itemClassName?: string;
  /** Имя цели гида (`data-tour`), если на навигацию указывает шаг тура */
  tourTarget?: string;
}) {
  const pathname = usePathname();
  const container = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  // Первый замер ставит маркер на место без движения; анимация включается со следующего кадра
  const [animated, setAnimated] = useState(false);

  const activeHref = items.find((item) => isActivePath(pathname, item.href))?.href ?? null;
  const targetHref = hovered ?? activeHref;

  useLayoutEffect(() => {
    const nav = container.current;
    if (!nav) return;
    const measure = () => {
      const target = targetHref === null ? null : nav.querySelector<HTMLElement>(`[data-href="${targetHref}"]`);
      setBox(target ? { left: target.offsetLeft, width: target.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    const frame = requestAnimationFrame(() => setAnimated(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [targetHref]);

  const measured = box !== null || animated;
  return (
    <nav
      ref={container}
      aria-label={label}
      data-tour={tourTarget}
      className={cn('relative flex items-stretch gap-1', className)}
      onPointerLeave={() => setHovered(null)}
      onBlur={() => setHovered(null)}
    >
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            data-href={item.href}
            aria-current={active ? 'page' : undefined}
            onPointerEnter={() => setHovered(item.href)}
            onFocus={() => setHovered(item.href)}
            className={cn(
              'inline-flex items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              active && !measured && 'border-primary',
              itemClassName,
            )}
          >
            {item.label}
          </Link>
        );
      })}
      <span
        aria-hidden="true"
        data-slot="nav-indicator"
        style={box ? { transform: `translateX(${box.left}px)`, width: box.width } : { width: 0 }}
        className={cn(
          'pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-primary',
          animated && 'transition-[transform,width,opacity] duration-(--duration-base) ease-(--ease-out)',
          box ? (hovered !== null && hovered !== activeHref ? 'opacity-50' : 'opacity-100') : 'opacity-0',
        )}
      />
    </nav>
  );
}
