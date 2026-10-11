import { cn } from '@/lib/utils';

/** Знак «Точка» (решение Q10): линия цены заканчивается жирной точкой — точным последним значением */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <rect width="24" height="24" rx="7" className="fill-primary" />
      <g className="text-primary-foreground">
        <path
          d="M5 16.5 9 12l3.2 2.6L16 9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="18.6" cy="7.6" r="2.7" fill="currentColor" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="hidden flex-col leading-none whitespace-nowrap sm:flex">
        <span className="text-sm font-bold tracking-tight">Crypto Price</span>
        <span className="text-[0.625rem] font-medium tracking-[0.2em] text-muted-foreground">TRACKER</span>
      </span>
    </span>
  );
}
