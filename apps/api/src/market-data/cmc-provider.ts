// Адаптер MarketDataProvider для CoinMarketCap Pro API (ADR 0015, 0006, 0007). Всё знание о формате CMC — здесь:
// ядро получает доменные Quote и классифицированные MarketDataError, а не AxiosError и сырой JSON.
// Аналог в Nest — провайдер-обёртка над HttpService; здесь axios-инстанс без DI.
import axios, { isAxiosError, type AxiosInstance } from 'axios';
import type { Clock } from '../common/clock.ts';
import { parsePrice } from '../common/decimal.ts';
import { isObject, parseCmcJson, type JsonObject } from './cmc-json.ts';
import {
  MarketDataError,
  MAX_IDS_PER_REQUEST,
  type CmcUsage,
  type MarketDataProvider,
  type Quote,
  type QuotesResult,
  type ResolvedCoin,
} from './provider.ts';

export type CmcProviderOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  /** Для Retry-After в виде HTTP-даты */
  clock: Clock;
};

const QUOTES = '/v2/cryptocurrency/quotes/latest';
const KEY_INFO = '/v1/key/info';
/** CHECK в cryptocurrencies.name */
const MAX_NAME_LENGTH = 100;

export class CmcMarketDataProvider implements MarketDataProvider {
  private readonly http: AxiosInstance;
  private readonly options: CmcProviderOptions;

  constructor(options: CmcProviderOptions) {
    this.options = options;
    this.http = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      // Ключ — только в заголовке: URL попадает в логи прокси и в сообщения ошибок axios (C4)
      headers: { 'X-CMC_PRO_API_KEY': options.apiKey, Accept: 'application/json' },
      // Тело получаем текстом и разбираем сами: стандартный JSON.parse axios потерял бы цифры цены (ADR 0006)
      responseType: 'text',
      transformResponse: [(data: unknown) => data],
    });
  }

  async resolveSymbol(symbol: string, cmcId?: number, signal?: AbortSignal): Promise<ResolvedCoin> {
    if (cmcId !== undefined) {
      // Явный выбор: монета должна существовать и носить именно этот символ, иначе клиент ошибся в паре
      const { data } = await this.get(QUOTES, { id: cmcId, skip_invalid: true }, signal);
      const coin = data[String(cmcId)];
      if (!isObject(coin) || String(coin['symbol']).toUpperCase() !== symbol) {
        throw new MarketDataError('CMC_UNKNOWN_SYMBOL', `CMC has no coin ${cmcId} with symbol ${symbol}`);
      }
      return toResolvedCoin(coin, symbol);
    }

    // Символы в CMC не уникальны: v2 отдаёт массив однофамильцев, берём активную монету с лучшим рангом (ADR 0013)
    const { data } = await this.get(QUOTES, { symbol }, signal);
    const list = data[symbol];
    const active = (Array.isArray(list) ? list : []).filter((coin) => isObject(coin) && coin['is_active'] === 1);
    const best = (active as JsonObject[]).sort((a, b) => rankOf(a) - rankOf(b) || Number(a['id']) - Number(b['id']))[0];
    if (best === undefined) throw new MarketDataError('CMC_UNKNOWN_SYMBOL', `CMC has no active coin ${symbol}`);
    return toResolvedCoin(best, symbol);
  }

  async getQuotes(cmcIds: readonly number[], signal?: AbortSignal): Promise<QuotesResult> {
    if (cmcIds.length === 0) return { quotes: [], missing: [], rejected: [], creditsUsed: 0 };
    if (cmcIds.length > MAX_IDS_PER_REQUEST) {
      throw new RangeError(`Не больше ${MAX_IDS_PER_REQUEST} id за запрос, получено ${cmcIds.length}`);
    }
    // skip_invalid: делистнутый id не роняет весь батч, а просто отсутствует в ответе → partial
    const { data, status } = await this.get(
      QUOTES,
      { id: cmcIds.join(','), convert: 'USD', skip_invalid: true },
      signal,
    );

    const result: QuotesResult = { quotes: [], missing: [], rejected: [], creditsUsed: null };
    for (const cmcId of cmcIds) {
      const coin = data[String(cmcId)];
      if (!isObject(coin)) {
        result.missing.push(cmcId);
        continue;
      }
      const quote = toQuote(cmcId, coin);
      if (typeof quote === 'string') result.rejected.push({ cmcId, reason: quote });
      else result.quotes.push(quote);
    }
    const credits = status?.['credit_count'];
    result.creditsUsed = isCount(credits) ? credits : null;
    return result;
  }

  async getUsage(signal?: AbortSignal): Promise<CmcUsage> {
    const { data } = await this.get(KEY_INFO, {}, signal);
    const plan = isObject(data['plan']) ? data['plan'] : {};
    const usage = isObject(data['usage']) ? data['usage'] : {};
    const day = isObject(usage['current_day']) ? usage['current_day'] : {};
    const month = isObject(usage['current_month']) ? usage['current_month'] : {};
    const fields = {
      creditLimitMonthly: plan['credit_limit_monthly'],
      creditsUsedMonth: month['credits_used'],
      creditsLeftMonth: month['credits_left'],
      creditsUsedToday: day['credits_used'],
    };
    const broken = Object.entries(fields).filter(([, value]) => !isCount(value));
    if (broken.length > 0) {
      throw new MarketDataError('CMC_BAD_RESPONSE', `CMC key/info has no valid ${broken.map(([k]) => k).join(', ')}`);
    }
    return fields as CmcUsage;
  }

  private async get(
    path: string,
    params: Record<string, string | number | boolean>,
    signal: AbortSignal | undefined,
  ): Promise<{ data: JsonObject; status: JsonObject | undefined }> {
    let text: unknown;
    try {
      text = (await this.http.get<string>(path, { params, signal })).data;
    } catch (error) {
      throw this.classify(error, signal);
    }
    let body: unknown;
    try {
      body = parseCmcJson(String(text));
    } catch (cause) {
      throw new MarketDataError('CMC_BAD_RESPONSE', 'CMC returned invalid JSON', { cause });
    }
    if (!isObject(body) || !isObject(body['data'])) {
      throw new MarketDataError('CMC_BAD_RESPONSE', 'CMC response has no data object');
    }
    return { data: body['data'], status: isObject(body['status']) ? body['status'] : undefined };
  }

  /** Ошибка axios → код из ADR 0015 §4. Отмену (shutdown) не классифицируем: её причина — signal.reason */
  private classify(error: unknown, signal: AbortSignal | undefined): unknown {
    if (!isAxiosError(error)) return error;
    // ERR_CANCELED бывает только от нашего signal
    if (error.code === 'ERR_CANCELED') return (signal as AbortSignal).reason;
    const response = error.response;
    if (response === undefined) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return new MarketDataError('CMC_TIMEOUT', `CMC did not respond within ${this.options.timeoutMs} ms`, {
          cause: error,
        });
      }
      // Обрыв, отказ в соединении, DNS
      return new MarketDataError('CMC_UNAVAILABLE', `CMC connection failed: ${error.code ?? error.message}`, {
        cause: error,
      });
    }

    const { status } = response;
    const detail = `CMC answered HTTP ${status}: ${cmcErrorMessage(response.data)}`;
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers['retry-after'], this.options.clock.now());
      return new MarketDataError('CMC_RATE_LIMITED', detail, { retryAfterMs, cause: error });
    }
    // 401 — неверный ключ, 402 — план не оплачен, 403 — эндпоинт не входит в план: всё это наша конфигурация
    if (status === 401 || status === 402 || status === 403)
      return new MarketDataError('CMC_AUTH', detail, { cause: error });
    if (status >= 500) return new MarketDataError('CMC_UNAVAILABLE', detail, { cause: error });
    // Неизвестный символ CMC отвечает 400 «Invalid value for "symbol"»
    if (status === 400 && /invalid value for "symbol"/i.test(detail)) {
      return new MarketDataError('CMC_UNKNOWN_SYMBOL', detail, { cause: error });
    }
    return new MarketDataError('CMC_BAD_RESPONSE', detail, { cause: error });
  }
}

function rankOf(coin: JsonObject): number {
  const rank = coin['cmc_rank'];
  // Монета без ранга (новая, малоликвидная) уступает любой ранжированной
  return typeof rank === 'number' && rank > 0 ? rank : Number.POSITIVE_INFINITY;
}

function toResolvedCoin(coin: JsonObject, symbol: string): ResolvedCoin {
  const id = coin['id'];
  const name = typeof coin['name'] === 'string' ? coin['name'].trim() : '';
  if (!isCount(id) || id === 0 || name === '') {
    throw new MarketDataError('CMC_BAD_RESPONSE', `CMC coin ${symbol} has no valid id or name`);
  }
  return { cmcId: id, symbol, name: name.slice(0, MAX_NAME_LENGTH) };
}

/** Котировка или причина, по которой её нельзя сохранить */
function toQuote(cmcId: number, coin: JsonObject): Quote | string {
  const quote = isObject(coin['quote']) ? coin['quote'] : {};
  const usd = isObject(quote['USD']) ? quote['USD'] : null;
  if (usd === null) return 'no USD quote';
  const price = usd['price'];
  if (typeof price !== 'string') return 'no price';
  let exact: string;
  try {
    exact = parsePrice(price).toString();
  } catch (error) {
    return (error as Error).message;
  }
  const updated = usd['last_updated'];
  const sourceUpdatedAt = typeof updated === 'string' ? Date.parse(updated) : Number.NaN;
  if (!(sourceUpdatedAt > 0)) return 'no valid last_updated';
  return { cmcId, price: exact, sourceUpdatedAt };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Текст ошибки из тела CMC { status: { error_message } }; тело может быть и HTML от прокси */
function cmcErrorMessage(data: unknown): string {
  try {
    // Тело всегда текст: responseType 'text' и transformResponse без разбора
    const body = JSON.parse(String(data)) as unknown;
    const status = isObject(body) ? body['status'] : undefined;
    const message = isObject(status) ? status['error_message'] : undefined;
    if (typeof message === 'string' && message !== '') return message.slice(0, 200);
  } catch {
    // не JSON — ниже общий текст
  }
  return 'no error message';
}

/** Retry-After: секунды или HTTP-дата (RFC 9110 §10.2.3). Непонятное значение — как отсутствие заголовка */
export function parseRetryAfter(value: unknown, now: number): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}
