'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bff } from '@/lib/bff-client';
import { SESSION_EXPIRED_URL, STREAM_URL } from '@/lib/bff-contract';
import type { Direction } from '@/lib/format';
import { refreshInBackground, type RefreshTarget } from './queries';
import { connectStream, type StreamStatus } from './stream-connection';
import { handleStreamEvent } from './stream-events';

/** Подсветка изменившейся цены держится не дольше секунды (решение Q6 дизайна) */
const FLASH_MS = 1000;

export type Flash = Exclude<Direction, 'flat'>;

/**
 * Поток событий экрана: пишет цены в кэш запросов, по остальным событиям перечитывает данные фоновым запросом.
 * Возвращает статус соединения и монеты, цена которых только что изменилась.
 */
export function usePriceStream(): { status: StreamStatus; flashes: ReadonlyMap<number, Flash> } {
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
    const refresh = (targets: readonly RefreshTarget[]) => void refreshInBackground(queryClient, bff, targets);
    const stop = connectStream({
      createSource: () => new EventSource(STREAM_URL),
      onEvent: (name, data) => handleStreamEvent({ queryClient, refresh, onPriceChange: flash }, name, data),
      onStatus: setStatus,
      // Пока поток был закрыт, могло измениться всё: цены, графики и состав списка
      onReopen: () => refresh(['prices', 'sparklines', 'coins']),
      // Причину отказа показывает обычный запрос: 401 уводит на страницу входа, 502 включает баннер
      onGiveUp: () => refresh(['prices']),
      onSessionExpired: () => window.location.assign(SESSION_EXPIRED_URL),
    });
    return () => {
      stop();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [queryClient, flash]);

  return { status, flashes };
}

/** Текущее время для подписей «2 мин назад»: обновляется по таймеру браузера, запросов не делает */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
