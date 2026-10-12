'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleDashed, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { Hint } from '@/components/ui/tooltip';
import { bff, BffError } from '@/lib/bff-client';
import { API_CONTRACT_VERSION } from '@/lib/bff-contract';
import { detectDegradation } from '@/lib/dashboard/degradation';
import { coinsQuery, pricesQuery } from '@/lib/dashboard/queries';
import { describeSystemStatus, type SystemTone } from '@/lib/dashboard/system-status';
import { usePriceStream } from '@/lib/dashboard/use-price-stream';
import { cn } from '@/lib/utils';
import type { Role } from '@/server/users';

const LINK =
  'rounded underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50';

/** Значок и текст вместе: состояние читается и без цвета */
const TONE: Record<SystemTone, { Icon: LucideIcon; className: string }> = {
  ok: { Icon: CircleCheck, className: 'text-up' },
  warn: { Icon: TriangleAlert, className: 'text-warn' },
  down: { Icon: CircleX, className: 'text-destructive' },
  unknown: { Icon: CircleDashed, className: 'text-muted-foreground' },
};

/**
 * Состояние системы. Запросы те же, что у дашборда, с теми же ключами кэша: на дашборде футер не делает
 * ни одного своего запроса, на остальных экранах — два при первом открытии. Оператору строка ведёт
 * в раздел «Система», где есть подробности; Viewer туда не пустят, поэтому у него это текст.
 */
function SystemStatusLine({ role }: { role: Role }) {
  const prices = useQuery(pricesQuery(bff));
  const coins = useQuery({ ...coinsQuery(bff), staleTime: Infinity });
  const { status: streamStatus } = usePriceStream();

  const pausedIds = useMemo(
    () => (coins.data ? new Set(coins.data.items.filter((coin) => coin.isPaused).map((coin) => coin.id)) : null),
    [coins.data],
  );
  const degradation = detectDegradation({
    prices: prices.data,
    pausedIds,
    refreshError:
      prices.data && prices.error
        ? { requestId: prices.error instanceof BffError ? prices.error.requestId : null }
        : null,
    pricesUpdatedAt: prices.dataUpdatedAt,
    streamStatus,
  });
  const { tone, text } = describeSystemStatus({ hasData: Boolean(prices.data), isError: prices.isError, degradation });
  const { Icon, className } = TONE[tone];

  const content = (
    <>
      <Icon className={cn('size-3.5 shrink-0', className)} aria-hidden="true" />
      {text}
    </>
  );
  return role === 'operator' ? (
    <Link href="/operator/system" className={cn(LINK, 'inline-flex items-center gap-1.5 no-underline hover:underline')}>
      {content}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-1.5">{content}</span>
  );
}

/** Атрибуция TradingView — требование лицензии Lightweight Charts (ADR 0012) */
export function AppFooter({ role }: { role: Role }) {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-xs text-muted-foreground">
        {/* Смена состояния объявляется скринридеру вежливо: это фон, а не событие, требующее действия */}
        <span role="status" aria-live="polite">
          <SystemStatusLine role={role} />
        </span>
        <span>
          Данные:{' '}
          <a className={LINK} href="https://coinmarketcap.com/" rel="noopener noreferrer" target="_blank">
            CoinMarketCap
          </a>{' '}
          · USD
        </span>
        <span>
          Графики:{' '}
          <a className={LINK} href="https://www.tradingview.com/" rel="noopener noreferrer" target="_blank">
            TradingView Lightweight Charts™
          </a>
        </span>
        <Hint text="Версия контракта OpenAPI, с которой собран веб-клиент">
          <span className="sm:ml-auto">API v{API_CONTRACT_VERSION}</span>
        </Hint>
      </div>
    </footer>
  );
}
