'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { Direction } from '@/lib/format';
import type { StreamStatus } from './stream-connection';

export type Flash = Exclude<Direction, 'flat'>;

export type PriceStream = { status: StreamStatus; flashes: ReadonlyMap<number, Flash> };

/** Значение задаёт `StreamProvider`: соединение одно на вкладку, экраны только читают его состояние */
export const PriceStreamContext = createContext<PriceStream | null>(null);

/** Статус соединения и монеты, цена которых только что изменилась. Сами данные экран читает из кэша запросов */
export function usePriceStream(): PriceStream {
  const stream = useContext(PriceStreamContext);
  if (!stream) throw new Error('usePriceStream вызван вне StreamProvider');
  return stream;
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
