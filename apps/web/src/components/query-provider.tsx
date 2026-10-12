'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { BffError } from '@/lib/bff-client';

/** Повтор имеет смысл, только если отказ временный: сеть или 5xx. Ответ 4xx от повтора не изменится */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const temporary = !(error instanceof BffError) || error.isUnavailable;
  return temporary && failureCount < 2;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Данные обновляет поток событий; таймера опроса нет (ADR 0016, поправка 26). 30 с — чтобы возврат
        // на вкладку перечитывал данные, а частые переключения окон не давали по запросу на каждое
        staleTime: 30_000,
        retry: shouldRetry,
      },
    },
  });
}

/** Кэш запросов — один на вкладку: создаётся в состоянии, а не в модуле, чтобы на сервере не делиться между запросами */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
