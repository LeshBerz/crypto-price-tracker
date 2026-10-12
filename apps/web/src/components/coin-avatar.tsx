import type { CSSProperties } from 'react';
import { Coins } from 'lucide-react';
import { cn } from 'cn';
import { coinHue } from '@/lib/coin-hue';

/**
 * Кружок монеты. Логотипов в контракте api нет (решение Q15), поэтому значок один, а тон подложки вычисляется
 * из символа: строки списка различаются взглядом, и у одной монеты тон одинаков на всех экранах.
 * Значок декоративный — рядом всегда стоит символ текстом.
 */
export function CoinAvatar({ symbol, size = 'md' }: { symbol: string; size?: 'md' | 'lg' }) {
  return (
    <span
      data-slot="coin-avatar"
      aria-hidden="true"
      style={{ '--coin-hue': coinHue(symbol) } as CSSProperties}
      className={cn(
        'coin-avatar inline-flex shrink-0 items-center justify-center rounded-full',
        size === 'lg' ? 'size-10' : 'size-8',
      )}
    >
      <Coins className={size === 'lg' ? 'size-5' : 'size-4'} />
    </span>
  );
}
