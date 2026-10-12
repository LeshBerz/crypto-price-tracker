// Пункты навигации. Скрытие пункта — удобство, а не защита: права проверяет сервер (ui-flows §1).
import type { Role } from '@/server/users';

export type NavItem = { href: string; label: string; roles: readonly Role[] };

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Дашборд', roles: ['viewer', 'operator'] },
  { href: '/operator', label: 'Оператор', roles: ['operator'] },
];

/** Профиль доступен любой роли и открывается из меню пользователя, а не из основной навигации */
export const PROFILE_HREF = '/profile';

/** Разделы панели оператора; новые добавляются сюда по мере появления экранов (ROADMAP, C7) */
export const OPERATOR_SECTIONS: readonly { href: string; label: string }[] = [
  { href: '/operator/watchlist', label: 'Watchlist' },
  { href: '/operator/sync', label: 'Синхронизация' },
  { href: '/operator/system', label: 'Система' },
  { href: '/operator/users', label: 'Пользователи' },
];

export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
