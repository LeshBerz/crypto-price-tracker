'use client';

import { GraduationCap } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { account } from '@/lib/account/client';
import type { Role, TourId } from '@/lib/account/contract';
import { tourForPath } from '@/lib/tour/layout';
import { stepsFor } from '@/lib/tour/steps';
import { GuidedTour } from './guided-tour';

/** Пауза перед автозапуском: экран успевает отрисоваться, а гид не выскакивает вместе со страницей */
export const AUTOSTART_DELAY_MS = 800;

type TourContextValue = {
  /** Тур текущего экрана; `null` — у экрана гида нет */
  available: TourId | null;
  start: () => void;
  /** «Пройти гид заново»: снять отметки и открыть гид текущего экрана */
  restart: () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

function useTour(): TourContextValue {
  const value = useContext(TourContext);
  if (!value) throw new Error('useTour: нет TourProvider');
  return value;
}

/**
 * Гид экранов после входа. Отметки «тур пройден» приходят с сервера вместе со страницей (layout читает web.db),
 * дальше состояние ведёт провайдер: layout при переходах не перерисовывается. Тур открывается сам при первом
 * открытии экрана; пройденный или пропущенный — только кнопкой «Гид» (ADR 0018).
 */
export function TourProvider({
  role,
  completed: initial,
  children,
}: {
  role: Role;
  completed: readonly TourId[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [completed, setCompleted] = useState<ReadonlySet<TourId>>(() => new Set(initial));
  /** `run` меняется при каждом запуске: компонент гида монтируется заново и начинает с первого шага */
  const [active, setActive] = useState<{ tour: TourId; run: number } | null>(null);
  const available = tourForPath(pathname, role);

  const open = useCallback((tour: TourId) => setActive((current) => current ?? { tour, run: Date.now() }), []);

  useEffect(() => {
    if (!available || active || completed.has(available)) return;
    const timer = setTimeout(() => open(available), AUTOSTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [available, active, completed, open]);

  const finish = (done: boolean) => {
    if (!active) return;
    const { tour } = active;
    setActive(null);
    setCompleted((current) => new Set(current).add(tour));
    // Отметка не сохранилась (нет связи) — гид откроется ещё раз после следующей загрузки страницы
    account.completeTour(tour).catch(() => undefined);
    if (!done) toast.info('Гид закрыт', 'Открыть его снова — кнопка «Гид» в шапке.');
  };

  const value = useMemo<TourContextValue>(
    () => ({
      available,
      start: () => {
        if (available) open(available);
      },
      restart: () => {
        account.resetTours().then(
          () => {
            setCompleted(new Set());
            if (available) open(available);
            else toast.info('Гид начнётся заново', 'Он откроется на дашборде, в карточке монеты и в панели оператора.');
          },
          () => toast.error('Не удалось сбросить отметки гида', 'Повторите попытку позже.'),
        );
      },
    }),
    [available, open],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && <GuidedTour key={active.run} steps={stepsFor(active.tour, role)} onClose={finish} />}
    </TourContext.Provider>
  );
}

/** Кнопка «Гид» в шапке: открывает тур текущего экрана. На экранах без тура её нет */
export function TourButton() {
  const { available, start } = useTour();
  if (!available) return null;
  return (
    <Button variant="ghost" size="sm" onClick={start} data-slot="tour-start">
      <GraduationCap aria-hidden="true" />
      <span className="max-sm:sr-only">Гид</span>
    </Button>
  );
}

/** Ссылка в футере: гид снова открывается сам на каждом экране */
export function TourRestartLink({ className }: { className?: string }) {
  const { restart } = useTour();
  return (
    <button type="button" onClick={restart} className={className}>
      Пройти гид заново
    </button>
  );
}
