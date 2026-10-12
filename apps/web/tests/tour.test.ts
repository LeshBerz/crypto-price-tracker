// Гид: шаги по ролям, тур по адресу, положение прожектора и карточки. Логика чистая — DOM не нужен.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOUR_IDS } from '@/lib/account/contract';
import { OPERATOR_SECTIONS } from '@/lib/navigation';
import { clampStep, DOCK_BELOW_WIDTH, placeCard, SPOT_PADDING, spotRect, tourForPath } from '@/lib/tour/layout';
import { stepsFor, type TourName } from '@/lib/tour/steps';

const TOURS: readonly TourName[] = [...TOUR_IDS, 'login'];
const DESKTOP = { width: 1280, height: 800 };
const CARD_HEIGHT = 240;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') ? [readFileSync(path, 'utf8')] : [];
  });
}

describe('[stepsFor] шаги туров', () => {
  it('✅ число шагов по ролям: у Viewer на дашборде нет шага про паузу', () => {
    expect(stepsFor('dashboard', 'viewer')).toHaveLength(8);
    expect(stepsFor('dashboard', 'operator')).toHaveLength(9);
    expect(stepsFor('coin', 'viewer')).toHaveLength(7);
    expect(stepsFor('operator', 'operator')).toHaveLength(12);
    expect(stepsFor('login', 'viewer')).toHaveLength(3);
  });

  it('✅ шаг с ролями скрыт от остальных: Viewer не видит пояснения про паузу', () => {
    const titles = (role: 'viewer' | 'operator') => stepsFor('dashboard', role).map((step) => step.title);
    expect(titles('operator')).toContain('Монета на паузе');
    expect(titles('viewer')).not.toContain('Монета на паузе');
  });

  it('✅ первый шаг дашборда говорит с ролью на её языке', () => {
    expect(stepsFor('dashboard', 'viewer')[0]?.body.join(' ')).toContain('Viewer');
    expect(stepsFor('dashboard', 'operator')[0]?.body.join(' ')).toContain('панель оператора');
  });

  it('✅ у каждого шага есть заголовок и текст; заголовки внутри тура не повторяются', () => {
    for (const tour of TOURS) {
      const steps = stepsFor(tour, 'operator');
      expect(new Set(steps.map((step) => step.title)).size).toBe(steps.length);
      for (const step of steps) {
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.body.length).toBeGreaterThan(0);
        // Абзацы — ключи списка в карточке: внутри шага они разные
        expect(new Set(step.body).size).toBe(step.body.length);
      }
    }
  });

  it('✅ у каждой цели есть элемент с таким `data-tour` в коде экранов', () => {
    const code = sources(join(__dirname, '../src')).join('\n');
    const targets = new Set(TOURS.flatMap((tour) => stepsFor(tour, 'operator').map((step) => step.target)));
    const missing = [...targets].filter(
      (target) => !code.includes(`data-tour="${target}"`) && !code.includes(`tourTarget="${target}"`),
    );
    expect(missing).toEqual([]);
  });

  it('✅ гид оператора ходит только по существующим разделам, остальные туры адрес не меняют', () => {
    const sections = OPERATOR_SECTIONS.map((section) => section.href);
    const paths = stepsFor('operator', 'operator').map((step) => step.path);
    expect(paths.every((path) => path !== undefined && sections.includes(path))).toBe(true);
    // Разделы идут подряд: гид не возвращается в уже пройденный раздел
    const visited = paths.filter((path, index) => path !== paths[index - 1]);
    expect(new Set(visited).size).toBe(visited.length);
    for (const tour of ['dashboard', 'coin', 'login'] as const) {
      expect(stepsFor(tour, 'operator').some((step) => step.path !== undefined)).toBe(false);
    }
  });
});

describe('[tourForPath] тур экрана по адресу', () => {
  it.each([
    ['/', 'viewer', 'dashboard'],
    ['/', 'operator', 'dashboard'],
    ['/coins/1', 'viewer', 'coin'],
    ['/coins/42', 'operator', 'coin'],
    ['/operator', 'operator', 'operator'],
    ['/operator/watchlist', 'operator', 'operator'],
    ['/operator/users', 'operator', 'operator'],
  ] as const)('✅ %s для %s → %s', (pathname, role, tour) => {
    expect(tourForPath(pathname, role)).toBe(tour);
  });

  it.each([
    ['/operator/watchlist', 'viewer'],
    ['/operator', 'viewer'],
    ['/profile', 'operator'],
    ['/coins', 'viewer'],
    ['/coins/1/history', 'viewer'],
    ['/operators', 'operator'],
  ] as const)('❌ %s для %s — гида нет', (pathname, role) => {
    expect(tourForPath(pathname, role)).toBeNull();
  });
});

describe('[spotRect] прожектор', () => {
  it('✅ цель с полем вокруг', () => {
    expect(spotRect({ left: 100, top: 200, width: 50, height: 20 }, DESKTOP)).toEqual({
      left: 100 - SPOT_PADDING,
      top: 200 - SPOT_PADDING,
      width: 50 + SPOT_PADDING * 2,
      height: 20 + SPOT_PADDING * 2,
    });
  });

  it('✅ цель у края и выше окна обрезается по окну', () => {
    expect(spotRect({ left: 0, top: -300, width: 1280, height: 2000 }, DESKTOP)).toEqual({
      left: 0,
      top: 0,
      width: 1280,
      height: 800,
    });
  });

  it('✅ цель целиком за пределами окна — нулевой размер, а не отрицательный', () => {
    const rect = spotRect({ left: 100, top: 1200, width: 50, height: 20 }, DESKTOP);
    expect(rect.height).toBe(0);
  });

  it('✅ без цели — точка в центре окна', () => {
    expect(spotRect(null, DESKTOP)).toEqual({ left: 640, top: 400, width: 0, height: 0 });
  });
});

describe('[placeCard] карточка', () => {
  const place = (target: Parameters<typeof placeCard>[0], viewport = DESKTOP) => {
    const placement = placeCard(target, CARD_HEIGHT, viewport);
    if (placement.docked) throw new Error('карточка прижата к низу');
    return placement;
  };
  const inside = (placement: { left: number; top: number; width: number }, viewport = DESKTOP) => {
    expect(placement.left).toBeGreaterThanOrEqual(0);
    expect(placement.top).toBeGreaterThanOrEqual(0);
    expect(placement.left + placement.width).toBeLessThanOrEqual(viewport.width);
    expect(placement.top + CARD_HEIGHT).toBeLessThanOrEqual(viewport.height);
  };

  it('✅ под целью, если снизу есть место', () => {
    const target = { left: 300, top: 100, width: 120, height: 30 };
    const placement = place(target);
    expect(placement.top).toBeGreaterThan(target.top + target.height);
    expect(placement.left).toBe(300);
    inside(placement);
  });

  it('✅ над целью, если снизу места нет', () => {
    const target = { left: 300, top: 700, width: 120, height: 30 };
    const placement = place(target);
    expect(placement.top + CARD_HEIGHT).toBeLessThan(target.top);
    inside(placement);
  });

  it('✅ сбоку, если цель занимает всю высоту окна', () => {
    const target = { left: 40, top: 20, width: 300, height: 760 };
    const placement = place(target);
    expect(placement.left).toBeGreaterThan(target.left + target.width);
    inside(placement);
  });

  it('✅ слева от цели, если справа места нет', () => {
    const target = { left: 900, top: 20, width: 360, height: 760 };
    const placement = place(target);
    expect(placement.left + placement.width).toBeLessThan(target.left);
    inside(placement);
  });

  it('✅ цель во всю ширину посреди окна — карточка у края, где свободнее, а не поверх цели', () => {
    // Низкое окно: карточка не помещается целиком ни под целью, ни над ней
    const short = { width: 1280, height: 600 };
    const above = place({ left: 10, top: 250, width: 1260, height: 200 }, short);
    expect(above.top).toBe(12);
    inside(above, short);

    const below = place({ left: 10, top: 150, width: 1260, height: 200 }, short);
    expect(below.top + CARD_HEIGHT).toBe(short.height - 12);
    inside(below, short);
  });

  it('✅ цель во всё окно — карточка остаётся в окне поверх неё', () => {
    inside(place({ left: 0, top: 0, width: 1280, height: 800 }));
  });

  it('✅ цель у правого края — карточка не выходит за окно', () => {
    inside(place({ left: 1250, top: 100, width: 20, height: 20 }));
  });

  it('✅ без цели — по центру окна', () => {
    const placement = place(null);
    expect(placement.left + placement.width / 2).toBe(DESKTOP.width / 2);
    expect(placement.top + CARD_HEIGHT / 2).toBe(DESKTOP.height / 2);
  });

  it('✅ узкое окно — карточка прижата к краю, от которого цель дальше', () => {
    const phone = { width: DOCK_BELOW_WIDTH - 1, height: 800 };
    const dock = (top: number) => placeCard({ left: 10, top, width: 100, height: 30 }, CARD_HEIGHT, phone);
    expect(dock(10)).toEqual({ docked: true, edge: 'bottom' });
    expect(dock(300)).toEqual({ docked: true, edge: 'bottom' });
    expect(dock(500)).toEqual({ docked: true, edge: 'top' });
    expect(dock(760)).toEqual({ docked: true, edge: 'top' });
    expect(placeCard(null, CARD_HEIGHT, phone)).toEqual({ docked: true, edge: 'bottom' });
    expect(placeCard(null, CARD_HEIGHT, { width: DOCK_BELOW_WIDTH, height: 800 }).docked).toBe(false);
  });

  it('✅ карточка выше окна не уходит за верхний край', () => {
    const placement = placeCard({ left: 300, top: 100, width: 120, height: 30 }, 900, DESKTOP);
    expect(placement.docked ? null : placement.top).toBeGreaterThanOrEqual(0);
  });
});

describe('[clampStep] границы тура', () => {
  it('✅ номер шага не выходит за первый и последний', () => {
    expect(clampStep(-1, 8)).toBe(0);
    expect(clampStep(3, 8)).toBe(3);
    expect(clampStep(8, 8)).toBe(7);
  });
});
