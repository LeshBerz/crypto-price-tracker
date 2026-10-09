// Порт MarketDataProvider (ADR 0015 §2): что ядру нужно от источника цен — в доменных типах, а не в формате ответа CMC.
// Адаптер — market-data/cmc-provider.ts (axios → CoinMarketCap Pro API или HTTP-стаб).

/** Котировка монеты в USD: цена — точная десятичная строка (ADR 0006), время — epoch ms */
export type Quote = { cmcId: number; price: string; sourceUpdatedAt: number };

export type QuotesResult = {
  quotes: Quote[];
  /** Запрошенные id, которых нет в ответе (делистинг, неверный id) — синхронизация станет partial */
  missing: number[];
  /** Монеты с невалидной котировкой: точка отброшена, остальной батч сохраняется (ADR 0006) */
  rejected: { cmcId: number; reason: string }[];
  /** Сколько кредитов CMC списал за вызов (status.credit_count); null — CMC не сообщил */
  creditsUsed: number | null;
};

export type ResolvedCoin = { cmcId: number; symbol: string; name: string };

export type CmcUsage = {
  creditLimitMonthly: number;
  creditsUsedMonth: number;
  creditsLeftMonth: number;
  creditsUsedToday: number;
};

export interface MarketDataProvider {
  /** Символ → монета CMC. Без cmcId — активная монета с лучшим cmc_rank (ADR 0013 №2). Не нашли — CMC_UNKNOWN_SYMBOL */
  resolveSymbol(symbol: string, cmcId?: number, signal?: AbortSignal): Promise<ResolvedCoin>;
  /** Котировки по id CMC, не больше 100 за вызов (1 кредит, ADR 0007) */
  getQuotes(cmcIds: readonly number[], signal?: AbortSignal): Promise<QuotesResult>;
  /** Использование кредитов (CMC key/info; кредиты не тратит) */
  getUsage(signal?: AbortSignal): Promise<CmcUsage>;
}

export const MAX_IDS_PER_REQUEST = 100;

/** Классификация ошибок CMC (ADR 0015 §4): код попадает в sync_runs.error_code и в GET /system/cmc */
export type MarketDataErrorCode =
  'CMC_TIMEOUT' | 'CMC_UNAVAILABLE' | 'CMC_RATE_LIMITED' | 'CMC_AUTH' | 'CMC_BAD_RESPONSE' | 'CMC_UNKNOWN_SYMBOL';

/** Повтор имеет смысл только для временных сбоев: ошибку ключа или формата ответа ретрай не исправит */
const RETRYABLE: ReadonlySet<MarketDataErrorCode> = new Set(['CMC_TIMEOUT', 'CMC_UNAVAILABLE', 'CMC_RATE_LIMITED']);

export class MarketDataError extends Error {
  override name = 'MarketDataError';
  readonly code: MarketDataErrorCode;
  /** Из заголовка Retry-After (только при 429), мс */
  readonly retryAfterMs: number | undefined;

  constructor(code: MarketDataErrorCode, message: string, options: { retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}
