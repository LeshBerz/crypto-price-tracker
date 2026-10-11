const LINK = 'underline underline-offset-2 hover:text-foreground';

/** Атрибуция TradingView — требование лицензии Lightweight Charts (ADR 0012) */
export function AppFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
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
      </div>
    </footer>
  );
}
