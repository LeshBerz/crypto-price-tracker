import { NavTabs } from '@/components/nav-tabs';
import type { NavItem } from '@/lib/navigation';

/** Основная навигация в шапке: пункты занимают всю её высоту, маркер лежит на нижней границе */
export function AppNav({ items }: { items: NavItem[] }) {
  return <NavTabs label="Основная навигация" items={items} className="h-full" itemClassName="px-2 sm:px-3" />;
}
