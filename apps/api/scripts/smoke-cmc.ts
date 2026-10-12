// Проверка формата живого ответа CoinMarketCap (риск ADR 0006: тесты идут против стаба, а формат задаёт CMC).
// Запуск: npm run smoke:cmc -w @cpt/api (нужен CMC_API_KEY в .env в корне репозитория). Тратит 2 кредита из 15 000 в месяц.
// В CI не запускается: ключа там нет, а сборка не должна зависеть от внешнего сервиса.
import { SystemClock } from '../src/common/clock.ts';
import { CmcMarketDataProvider } from '../src/market-data/cmc-provider.ts';
import { MarketDataError } from '../src/market-data/provider.ts';

const apiKey = process.env['CMC_API_KEY']?.trim();
if (!apiKey) {
  process.stderr.write('smoke:cmc: CMC_API_KEY не задан — проверка пропущена. Ключ: https://coinmarketcap.com/api/\n');
  process.exit(2);
}

const provider = new CmcMarketDataProvider({
  baseUrl: process.env['CMC_BASE_URL']?.trim() || 'https://pro-api.coinmarketcap.com',
  apiKey,
  timeoutMs: 10_000,
  clock: new SystemClock(),
});

const DECIMAL = /^\d+(\.\d+)?$/;
const failures: string[] = [];
const expect = (what: string, ok: boolean, got: unknown) => {
  process.stdout.write(`${ok ? '✅' : '❌'} ${what}: ${JSON.stringify(got)}\n`);
  if (!ok) failures.push(what);
};

try {
  const btc = await provider.resolveSymbol('BTC');
  expect('resolveSymbol(BTC) → cmcId 1', btc.cmcId === 1 && btc.symbol === 'BTC', btc);

  const { quotes, missing, rejected, creditsUsed } = await provider.getQuotes([1, 1027]);
  expect(
    'getQuotes([1, 1027]) → 2 котировки, без missing и rejected',
    quotes.length === 2 && missing.length + rejected.length === 0,
    {
      quotes: quotes.length,
      missing,
      rejected,
    },
  );
  for (const quote of quotes) {
    expect(`цена ${quote.cmcId} — десятичная строка без экспоненты`, DECIMAL.test(quote.price), quote.price);
    const ageMs = Date.now() - quote.sourceUpdatedAt;
    expect(`last_updated ${quote.cmcId} — не старше суток и не из будущего`, ageMs > -60_000 && ageMs < 86_400_000, {
      sourceUpdatedAt: new Date(quote.sourceUpdatedAt).toISOString(),
    });
  }
  expect('credit_count — число', typeof creditsUsed === 'number', creditsUsed);

  const usage = await provider.getUsage();
  expect('key/info → лимит и остаток кредитов', usage.creditLimitMonthly > 0 && usage.creditsLeftMonth >= 0, usage);
} catch (error) {
  // Сообщение MarketDataError не содержит ключа: он уходит только в заголовке
  const reason = error instanceof MarketDataError ? `${error.code}: ${error.message}` : String(error);
  process.stderr.write(`smoke:cmc: запрос к CMC не удался — ${reason}\n`);
  process.exit(1);
}

if (failures.length > 0) {
  process.stderr.write(`smoke:cmc: формат ответа CMC не совпал с ожидаемым (${failures.length})\n`);
  process.exit(1);
}
process.stdout.write('smoke:cmc: OK — живой ответ CMC разбирается адаптером без потерь\n');
