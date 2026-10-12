'use client';

import { GraduationCap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GuidedTour } from '@/components/tour/guided-tour';
import { AUTOSTART_DELAY_MS } from '@/components/tour/tour-provider';
import { Button } from '@/components/ui/button';
import { stepsFor } from '@/lib/tour/steps';

/** До входа пользователя нет, поэтому отметка тура экрана входа — на браузер, а не в web.db */
export const LOGIN_TOUR_STORAGE_KEY = 'cpt-tour-login';

/** Хранилище может быть недоступно (приватный режим, запрет сайта): тогда гид просто откроется ещё раз */
function wasSeen(): boolean {
  try {
    return localStorage.getItem(LOGIN_TOUR_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(LOGIN_TOUR_STORAGE_KEY, '1');
  } catch {
    // Отметка не сохранилась — не причина мешать входу
  }
}

// Роль экрану входа неизвестна; шаги этого тура от неё не зависят
const STEPS = stepsFor('login', 'viewer');

/** Гид экрана входа: открывается сам при первом посещении с этого браузера, дальше — кнопкой */
export function LoginTour() {
  const [run, setRun] = useState<number | null>(null);

  useEffect(() => {
    if (wasSeen()) return;
    const timer = setTimeout(() => setRun((current) => current ?? Date.now()), AUTOSTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setRun((current) => current ?? Date.now())}>
        <GraduationCap aria-hidden="true" />
        Гид
      </Button>
      {run !== null && (
        <GuidedTour
          key={run}
          steps={STEPS}
          onClose={() => {
            markSeen();
            setRun(null);
          }}
        />
      )}
    </>
  );
}
