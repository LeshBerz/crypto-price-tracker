// Пункты навигации. Скрытие пункта — удобство, а не защита: права проверяет сервер (ui-flows §1).
import type { Role } from '@/server/users';

export type NavItem = { href: string; label: string; roles: readonly Role[] };

/** Разделы оператора добавляются сюда по мере появления экранов (ROADMAP, C5–C7) */
export const NAV_ITEMS: readonly NavItem[] = [{ href: '/', label: 'Дашборд', roles: ['viewer', 'operator'] }];

export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
