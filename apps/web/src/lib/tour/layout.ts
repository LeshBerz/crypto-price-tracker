// Геометрия гида: какой тур у адреса, где стоит прожектор и куда встаёт карточка. Чистые функции без DOM —
// компонент только измеряет прямоугольники и применяет результат.
import type { Role, TourId } from '@/lib/account/contract';

/** Тур экрана по адресу страницы; `null` — у экрана гида нет (профиль) или роль его не видит */
export function tourForPath(pathname: string, role: Role): TourId | null {
  if (pathname === '/') return 'dashboard';
  if (/^\/coins\/[^/]+$/.test(pathname)) return 'coin';
  if (role === 'operator' && (pathname === '/operator' || pathname.startsWith('/operator/'))) return 'operator';
  return null;
}

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Поле вокруг цели внутри прожектора */
export const SPOT_PADDING = 6;
/** Отступ карточки от краёв окна и от прожектора */
const EDGE = 12;
const CARD_MAX_WIDTH = 380;
const CARD_MAX_WIDTH_CENTERED = 420;
/**
 * На такой высоте окна гид ставит верх цели перед показом шага: ниже липкой шапки (56 px) и с запасом.
 * Цель у верха окна оставляет под собой больше всего места для карточки.
 */
export const TARGET_TOP_OFFSET = 96;
/** Уже этого окно считается телефоном: карточка прижата к краю окна и не закрывает цель */
export const DOCK_BELOW_WIDTH = 640;

/**
 * Прожектор: прямоугольник цели с полем, обрезанный по окну — цель выше экрана не даёт рамке уйти за край.
 * Без цели — точка в центре: тень вокруг неё затемняет весь экран.
 */
export function spotRect(target: Rect | null, viewport: Size): Rect {
  if (!target) return { left: viewport.width / 2, top: viewport.height / 2, width: 0, height: 0 };
  const left = Math.max(0, target.left - SPOT_PADDING);
  const top = Math.max(0, target.top - SPOT_PADDING);
  const right = Math.min(viewport.width, target.left + target.width + SPOT_PADDING);
  const bottom = Math.min(viewport.height, target.top + target.height + SPOT_PADDING);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export type CardPlacement =
  { docked: true; edge: 'top' | 'bottom' } | { docked: false; left: number; top: number; width: number };

/**
 * Место карточки. Порядок попыток: под целью → над целью → у свободного края окна, со сдвигом вбок, если
 * карточка перекрывает цель. Если не помещается нигде (цель во всё окно) — карточка остаётся в окне поверх
 * цели: текст важнее подсветки.
 */
export function placeCard(target: Rect | null, cardHeight: number, viewport: Size): CardPlacement {
  if (viewport.width < DOCK_BELOW_WIDTH) {
    // Телефон: карточка во всю ширину у того края окна, от которого цель дальше; без цели — внизу
    const spaceBelow = target ? viewport.height - (target.top + target.height) : viewport.height;
    return { docked: true, edge: target && target.top > spaceBelow ? 'top' : 'bottom' };
  }

  if (!target) {
    const width = Math.min(CARD_MAX_WIDTH_CENTERED, viewport.width - EDGE * 2);
    return {
      docked: false,
      width,
      left: (viewport.width - width) / 2,
      top: Math.max(EDGE, (viewport.height - cardHeight) / 2),
    };
  }

  const width = Math.min(CARD_MAX_WIDTH, viewport.width - EDGE * 2);
  const gap = SPOT_PADDING + EDGE;
  const bottom = target.top + target.height;
  const right = target.left + target.width;
  const lowest = Math.max(EDGE, viewport.height - cardHeight - EDGE);

  let top = bottom + gap;
  if (top + cardHeight > viewport.height - EDGE) top = target.top - gap - cardHeight;
  // Не помещается ни снизу, ни сверху: к тому краю окна, где свободнее, — так цель закрыта меньше всего
  if (top < EDGE) top = viewport.height - bottom >= target.top ? lowest : EDGE;

  let left = Math.min(Math.max(EDGE, target.left), viewport.width - width - EDGE);
  const overlaps = top < bottom && top + cardHeight > target.top;
  if (overlaps && right + gap + width + EDGE <= viewport.width) left = right + gap;
  else if (overlaps && target.left - gap - width >= EDGE) left = target.left - gap - width;

  return { docked: false, left, top, width };
}

/** Номер шага в границах тура: частые нажатия «Далее» и «Назад» не выводят за первый и последний шаг */
export function clampStep(index: number, total: number): number {
  return Math.max(0, Math.min(index, total - 1));
}
