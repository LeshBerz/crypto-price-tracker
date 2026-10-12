import { NavTabs } from '@/components/nav-tabs';
import { OPERATOR_SECTIONS } from '@/lib/navigation';

/**
 * Разделы панели оператора — отдельные адреса: ссылка на раздел открывает его сразу и переживает обновление
 * страницы. На узком экране ряд не переносится на вторую строку, а прокручивается по горизонтали.
 */
export function OperatorNav() {
  return (
    <NavTabs
      label="Разделы оператора"
      tourTarget="operator-nav"
      items={OPERATOR_SECTIONS}
      className="[scrollbar-width:none] overflow-x-auto border-b"
      itemClassName="h-10"
    />
  );
}
