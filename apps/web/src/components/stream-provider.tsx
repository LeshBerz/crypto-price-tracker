'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bff } from '@/lib/bff-client';
import { SESSION_EXPIRED_URL, STREAM_URL } from '@/lib/bff-contract';
import { ALL_TARGETS, refreshInBackground, type RefreshTarget } from '@/lib/dashboard/queries';
import { connectStream, type StreamStatus } from '@/lib/dashboard/stream-connection';
import { handleStreamEvent } from '@/lib/dashboard/stream-events';
import { PriceStreamContext, type Flash } from '@/lib/dashboard/use-price-stream';

/** Подсветка изменившейся цены держится не дольше секунды (решение Q6 дизайна) */
const FLASH_MS = 1000;

/**
 * Поток событий — один на вкладку: соединение живёт в layout группы (app) и не закрывается при переходе между
 * экранами. События пишут цены в кэш запросов, по остальным данные перечитываются фоновым запросом; экраны
 * подписаны на кэш, а не на поток. Отзыв сессии (`session.expired`) срабатывает на любом экране.
 */
export function StreamProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [flashes, setFlashes] = useState<ReadonlyMap<number, Flash>>(new Map());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const flash = useCallback((id: number, direction: Flash) => {
    setFlashes((current) => new Map(current).set(id, direction));
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setFlashes((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }, FLASH_MS),
    );
  }, []);

  useEffect(() => {
    const pending = timers.current;
    const refresh = (targets: readonly RefreshTarget[], options?: { probe: boolean }) =>
      void refreshInBackground(queryClient, bff, targets, options);
    const stop = connectStream({
      createSource: () => new EventSource(STREAM_URL),
      onEvent: (name, data) => handleStreamEvent({ queryClient, refresh, onPriceChange: flash }, name, data),
      onStatus: setStatus,
      // Пока поток был закрыт, могло измениться всё: цены, графики, история и состав списка
      onReopen: () => refresh(ALL_TARGETS),
      // Причину отказа показывает обычный запрос: 401 уводит на страницу входа, 502 включает баннер
      onGiveUp: () => refresh(['prices', 'coin'], { probe: true }),
      onSessionExpired: () => window.location.assign(SESSION_EXPIRED_URL),
    });
    return () => {
      stop();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [queryClient, flash]);

  const value = useMemo(() => ({ status, flashes }), [status, flashes]);
  return <PriceStreamContext value={value}>{children}</PriceStreamContext>;
}
