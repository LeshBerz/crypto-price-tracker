'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  Activity,
  ArrowUpDown,
  BookOpen,
  ChartCandlestick,
  ChartSpline,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Compass,
  Crosshair,
  Database,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  List,
  Lock,
  Pause,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Timer,
  Trash2,
  TriangleAlert,
  Users,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { clampStep, placeCard, spotRect, TARGET_TOP_OFFSET, type CardPlacement, type Rect } from '@/lib/tour/layout';
import type { TourIcon, TourStep } from '@/lib/tour/steps';

const ICONS: Record<TourIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  sync: RefreshCw,
  stream: Radio,
  price: Crosshair,
  change: ArrowUpDown,
  chart: ChartSpline,
  clock: Clock,
  pause: Pause,
  guide: GraduationCap,
  coin: Coins,
  controls: ChartCandlestick,
  attribution: BookOpen,
  summary: Gauge,
  history: List,
  compass: Compass,
  add: Plus,
  warning: TriangleAlert,
  offline: WifiOff,
  delete: Trash2,
  activity: Activity,
  quota: Timer,
  health: ShieldCheck,
  users: Users,
  lock: Lock,
  shield: ShieldCheck,
};

/** Сколько ждать появления цели после открытия экрана или раздела: данные могут ещё грузиться */
const TARGET_WAIT_MS = 3000;
/** На уже открытом экране цель либо есть, либо её не будет (нет монеты на паузе): долго ждать незачем */
const TARGET_WAIT_SETTLED_MS = 300;
const TARGET_POLL_MS = 100;

/** Первый видимый элемент с `data-tour`: у списка две раскладки, и на экране всегда только одна из них */
function findTarget(name: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    if (element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden') return element;
  }
  return null;
}

type Layout = { spot: Rect; card: CardPlacement; hasTarget: boolean };

function sameLayout(a: Layout | null, b: Layout): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Гид по экрану: затемнение с «прожектором» на элементе и карточка с пояснением (ADR 0018).
 *
 * Карточка — Base UI `Dialog` в режиме `trap-focus`: фокус не выходит из карточки, Esc закрывает, после закрытия
 * фокус возвращается туда, где был. Прокрутку страницы режим не блокирует — гид сам подводит цель в центр окна.
 * Нажатия мимо карточки принимает прозрачная подложка: экран под гидом не реагирует, а гид не закрывается.
 *
 * Компонент монтируется на один проход тура: номер шага начинается с нуля без сброса состояния.
 */
export function GuidedTour({
  steps,
  onClose,
}: {
  steps: readonly TourStep[];
  /** `completed` — пройден до конца; `false` — закрыт раньше */
  onClose: (completed: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  /** Шаг, который запрошен кнопками */
  const [index, setIndex] = useState(0);
  /** Шаг, цель которого уже найдена: он на экране. Отстаёт от `index`, пока открывается раздел или грузятся данные */
  const [shown, setShown] = useState<number | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const completed = useRef(false);
  /** Экран только что открыт (старт тура, переход в другой раздел): его данные могут ещё не прийти */
  const settling = useRef(true);

  const total = steps.length;
  const requested = steps[index];

  // Поиск цели запрошенного шага: при необходимости сначала открывается нужный раздел
  useEffect(() => {
    if (!open || !requested) return;
    if (requested.path && pathname !== requested.path) {
      settling.current = true;
      router.push(requested.path, { scroll: false });
      return;
    }
    const deadline = Date.now() + (settling.current ? TARGET_WAIT_MS : TARGET_WAIT_SETTLED_MS);
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      const target = findTarget(requested.target);
      if (!target && Date.now() < deadline) {
        timer = setTimeout(look, TARGET_POLL_MS);
        return;
      }
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (target) {
        const top = window.scrollY + target.getBoundingClientRect().top - TARGET_TOP_OFFSET;
        window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
      }
      // Цель так и не появилась (например, на паузе нет ни одной монеты) — шаг показывается без прожектора
      if (target) settling.current = false;
      setShown(index);
    };
    timer = setTimeout(look, 0);
    return () => clearTimeout(timer);
  }, [open, index, requested, pathname, router]);

  const step = shown === null ? undefined : steps[shown];

  const measure = useCallback(() => {
    const card = cardRef.current;
    if (!step || !card) return;
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const box = findTarget(step.target)?.getBoundingClientRect();
    const target = box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
    const next: Layout = {
      spot: spotRect(target, viewport),
      card: placeCard(target, card.offsetHeight, viewport),
      hasTarget: target !== null,
    };
    setLayout((current) => (sameLayout(current, next) ? current : next));
  }, [step]);

  // Положение пересчитывается при прокрутке (в том числе плавной — к цели), изменении окна и высоты карточки
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!step || !card) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, { capture: true });
    };
  }, [step, measure]);

  // «Назад» на первом шаге отключается: фокус с отключённой кнопки переносится на «Далее», иначе стрелки замолчат
  useEffect(() => {
    const active = document.activeElement;
    if (shown !== null && (!cardRef.current?.contains(active) || (active as HTMLButtonElement).disabled)) {
      nextRef.current?.focus({ preventScroll: true });
    }
  }, [shown]);

  const close = (done: boolean) => {
    completed.current = done;
    setOpen(false);
  };
  // Пока запрошенный шаг не на экране (открывается раздел, грузятся данные), нажатия не копятся: иначе
  // несколько быстрых «Далее» перескочили бы шаги, которых пользователь не видел
  const pending = shown !== index;
  const next = () => {
    if (pending) return;
    if (index >= total - 1) close(true);
    else setIndex(clampStep(index + 1, total));
  };
  const previous = () => {
    if (!pending) setIndex(clampStep(index - 1, total));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    }
  };

  const last = index >= total - 1;
  const number = (shown ?? 0) + 1;
  const Icon = step ? ICONS[step.icon] : Compass;
  const card = layout?.card;

  return (
    <DialogPrimitive.Root
      open={open}
      modal="trap-focus"
      disablePointerDismissal
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close(false);
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) onClose(completed.current);
      }}
    >
      <DialogPrimitive.Portal>
        <div data-slot="tour-veil" className="fixed inset-0 z-[80]" />
        <div
          data-slot="tour-spot"
          data-target={layout?.hasTarget ?? false}
          aria-hidden="true"
          className={cn('tour-spot', !layout && 'opacity-0')}
          style={layout?.spot}
        />
        <DialogPrimitive.Popup
          ref={cardRef}
          data-slot="tour-card"
          // Режим `trap-focus` атрибут не ставит, а экран под гидом недоступен: подложка принимает нажатия
          aria-modal="true"
          aria-busy={pending}
          initialFocus={nextRef}
          onKeyDown={onKeyDown}
          className={cn(
            'fixed z-[81] flex max-h-[calc(100dvh-1.5rem)] flex-col gap-2 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none',
            'transition-[left,top,opacity,translate] duration-(--duration-slow) ease-(--ease-out) data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0',
            // Телефон: карточка во всю ширину у края окна, дальнего от подсвеченного элемента
            card?.docked && 'inset-x-3 max-h-[55dvh]',
            card?.docked && (card.edge === 'top' ? 'top-3' : 'bottom-3'),
            // До первого замера карточка стоит по центру невидимой: фокус в неё уже попал, а прыжка нет
            !card && 'top-1/2 left-1/2 w-[min(23.75rem,calc(100vw-1.5rem))] -translate-1/2 opacity-0',
          )}
          style={card && !card.docked ? { left: card.left, top: card.top, width: card.width } : undefined}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
              Шаг {number} из {total}
            </span>
            <button
              type="button"
              onClick={() => close(false)}
              aria-label="Закрыть гид"
              className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-(--duration-slow) ease-(--ease-out)"
              style={{ width: `${(number / total) * 100}%` }}
            />
          </div>

          <DialogPrimitive.Title className="flex items-center gap-2 text-base font-semibold">
            <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
            {step?.title ?? 'Гид'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description render={<div />} className="flex flex-col gap-2 leading-relaxed">
            {step?.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {step?.api && (
              <p className="flex items-start gap-1.5 rounded-lg bg-surface px-2 py-1.5 text-[0.8125rem] text-muted-foreground">
                <Database className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  Данные: <span className="font-mono text-foreground">{step.api}</span>
                </span>
              </p>
            )}
            {step?.hint && (
              <p className="flex items-start gap-1.5 rounded-lg bg-surface px-2 py-1.5 text-[0.8125rem] text-muted-foreground">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span>{step.hint}</span>
              </p>
            )}
          </DialogPrimitive.Description>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => close(false)}>
              Пропустить
            </Button>
            <span className="flex-1" />
            <Button variant="outline" size="sm" onClick={previous} disabled={index === 0} aria-keyshortcuts="ArrowLeft">
              <ChevronLeft aria-hidden="true" />
              Назад
            </Button>
            <Button ref={nextRef} size="sm" onClick={next} aria-keyshortcuts="ArrowRight">
              {last ? 'Готово' : 'Далее'}
              {!last && <ChevronRight aria-hidden="true" />}
            </Button>
          </div>

          {/* Смену шага скринридер объявляет коротко: номер и заголовок, текст читается из карточки */}
          <span className="sr-only" aria-live="polite">
            {step ? `Шаг ${number} из ${total}. ${step.title}` : ''}
          </span>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
