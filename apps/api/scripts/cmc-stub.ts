// HTTP-стаб CoinMarketCap на node:http (ADR 0009): настоящий сокет, поэтому таймауты, обрывы, 429 + Retry-After
// и разбор точных цен проверяются по-настоящему, без моков axios. Тот же стаб станет контейнером cmc-stub (B16).
// Без зависимостей: только node:*. import.meta не используем — файл импортирует Jest (CommonJS).
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type StubCoin = {
  id: number;
  symbol: string;
  name: string;
  rank: number | null;
  isActive?: boolean;
  /** Цена как текст JSON-числа: уходит в тело без кавычек, ровно как у CMC */
  price: string | null;
  lastUpdated: string;
};

/** Разовая неисправность: применяется к следующему запросу и снимается с очереди */
export type StubFault =
  | { kind: 'status'; status: number; body?: string; headers?: Record<string, string> }
  | { kind: 'drop' } // обрыв соединения без ответа
  | { kind: 'hang' } // не отвечать вовсе — таймаут клиента
  | { kind: 'raw'; body: string }; // 200 с произвольным телом (битый JSON и т. п.)

export type StubRequest = { method: string; path: string; query: Record<string, string>; apiKey: string | undefined };

export type StubUsage = { creditLimitMonthly: number; creditsUsedMonth: number; creditsUsedToday: number };

export type CmcStubOptions = { apiKey?: string; coins?: StubCoin[]; usage?: StubUsage; port?: number; host?: string };

export const DEFAULT_COINS: StubCoin[] = [
  {
    id: 1,
    symbol: 'BTC',
    name: 'Bitcoin',
    rank: 1,
    price: '67123.451234567891',
    lastUpdated: '2026-10-07T11:59:00.000Z',
  },
  { id: 1027, symbol: 'ETH', name: 'Ethereum', rank: 2, price: '2456.78', lastUpdated: '2026-10-07T11:59:00.000Z' },
  // Мем-токен: 22 знака после запятой — JSON.parse превратил бы его в 1.2345678901234e-9
  {
    id: 99001,
    symbol: 'MEME',
    name: 'Meme Token',
    rank: 900,
    price: '0.0000000012345678901234',
    lastUpdated: '2026-10-07T11:59:00.000Z',
  },
  // Однофамильцы BTC: выбирается активная монета с лучшим рангом
  {
    id: 99002,
    symbol: 'BTC',
    name: 'Bitcoin Clone',
    rank: 4000,
    price: '0.01',
    lastUpdated: '2026-10-07T11:59:00.000Z',
  },
  {
    id: 99003,
    symbol: 'BTC',
    name: 'Dead Bitcoin',
    rank: null,
    isActive: false,
    price: null,
    lastUpdated: '2026-10-07T11:59:00.000Z',
  },
];

export const STUB_API_KEY = 'stub-cmc-key';

const RAW = '__raw__:';

export type CmcStub = {
  url: string;
  requests: StubRequest[];
  coins: StubCoin[];
  /** Поставить неисправности в очередь: каждая — на один следующий запрос */
  fail(...faults: StubFault[]): void;
  close(): Promise<void>;
};

export async function startCmcStub(options: CmcStubOptions = {}): Promise<CmcStub> {
  const apiKey = options.apiKey ?? STUB_API_KEY;
  const coins = options.coins ?? structuredClone(DEFAULT_COINS);
  const usage = options.usage ?? { creditLimitMonthly: 10_000, creditsUsedMonth: 120, creditsUsedToday: 7 };
  const faults: StubFault[] = [];
  const requests: StubRequest[] = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    const header = req.headers['x-cmc_pro_api_key'];
    const request: StubRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      apiKey: typeof header === 'string' ? header : undefined,
    };
    requests.push(request);

    const fault = faults.shift();
    if (fault?.kind === 'drop') return void req.socket.destroy();
    if (fault?.kind === 'hang') return;
    if (fault?.kind === 'raw') return send(res, 200, fault.body);
    if (fault?.kind === 'status')
      return send(res, fault.status, fault.body ?? errorBody(fault.status, 'Stub fault'), fault.headers);

    if (request.apiKey !== apiKey) return send(res, 401, errorBody(1001, 'This API Key is invalid.'));
    if (request.path === '/v2/cryptocurrency/quotes/latest') return quotes(request, res);
    if (request.path === '/v1/key/info') return keyInfo(res);
    return send(res, 404, errorBody(404, 'Not found'));
  });

  function quotes(request: StubRequest, res: ServerResponse) {
    const skipInvalid = request.query['skip_invalid'] === 'true';
    const { id, symbol } = request.query;
    const data: Record<string, unknown> = {};
    if (id !== undefined) {
      const ids = id.split(',').map(Number);
      const unknown = ids.filter((x) => !coins.some((c) => c.id === x));
      if (unknown.length > 0 && !skipInvalid) {
        return send(res, 400, errorBody(400, `Invalid value for "id": "${unknown.join(',')}"`));
      }
      for (const coin of coins.filter((c) => ids.includes(c.id))) data[String(coin.id)] = toCmc(coin);
    } else if (symbol !== undefined) {
      const matching = coins.filter((c) => c.symbol === symbol);
      if (matching.length === 0) return send(res, 400, errorBody(400, `Invalid value for "symbol": "${symbol}"`));
      data[symbol] = matching.map(toCmc);
    } else {
      return send(res, 400, errorBody(400, '"id" or "symbol" is required'));
    }
    // 1 кредит на каждые 100 монет (ADR 0007)
    const count = Object.keys(data).length;
    send(res, 200, body({ status: status(Math.max(1, Math.ceil(count / 100))), data }));
  }

  function keyInfo(res: ServerResponse) {
    send(
      res,
      200,
      body({
        status: status(0),
        data: {
          plan: { credit_limit_monthly: usage.creditLimitMonthly },
          usage: {
            current_day: { credits_used: usage.creditsUsedToday },
            current_month: {
              credits_used: usage.creditsUsedMonth,
              credits_left: Math.max(0, usage.creditLimitMonthly - usage.creditsUsedMonth),
            },
          },
        },
      }),
    );
  }

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    coins,
    fail: (...items) => faults.push(...items),
    close: () =>
      new Promise((resolve) => {
        // «Повисшие» запросы (hang) держат соединение — рвём их, иначе close ждал бы вечно
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function toCmc(coin: StubCoin) {
  return {
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    is_active: coin.isActive === false ? 0 : 1,
    cmc_rank: coin.rank,
    last_updated: coin.lastUpdated,
    quote: { USD: { price: coin.price === null ? null : `${RAW}${coin.price}`, last_updated: coin.lastUpdated } },
  };
}

function status(creditCount: number) {
  return {
    timestamp: '2026-10-07T12:00:00.000Z',
    error_code: 0,
    error_message: null,
    elapsed: 1,
    credit_count: creditCount,
  };
}

/** JSON, в котором цены — числа с исходным текстом без округления (как в живом ответе CMC) */
function body(value: unknown): string {
  return JSON.stringify(value).replace(new RegExp(`"${RAW}([^"]*)"`, 'g'), '$1');
}

function errorBody(code: number, message: string): string {
  return body({ status: { ...status(0), error_code: code, error_message: message }, data: null });
}

function send(res: ServerResponse, code: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(text);
}
