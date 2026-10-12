// Пункты навигации. Скрытие пункта — удобство, а не защита: права проверяет сервер (ui-flows §1).
import type { Role } from '@/server/users';

export type NavItem = { href: string; label: string; roles: readonly Role[] };

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Дашборд', roles: ['viewer', 'operator'] },
  { href: '/operator', label: 'Оператор', roles: ['operator'] },
];

/** Разделы панели оператора; новые добавляются сюда по мере появления экранов (ROADMAP, C6–C7) */
export const OPERATOR_SECTIONS: readonly { href: string; label: string }[] = [
  { href: '/operator/watchlist', label: 'Watchlist' },
  { href: '/operator/sync', label: 'Синхронизация' },
  { href: '/operator/system', label: 'Система' },
];

export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
