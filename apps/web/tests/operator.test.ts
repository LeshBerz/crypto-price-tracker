// Панель оператора (C5): запись через BFF, разбор отказов api, работа с кэшем и расчёты экрана «Система».
import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { BffError, createBffClient, type BffClient, type Problem } from '@/lib/bff-client';
import { coinKeys, type Cryptocurrency } from '@/lib/coin/queries';
import { coinsQuery, dashboardKeys, refreshInBackground, type CryptocurrencyList } from '@/lib/dashboard/queries';
import { handleStreamEvent } from '@/lib/dashboard/stream-events';
import { formatCount, formatDuration, formatInterval } from '@/lib/format';
import { isActivePath, navItemsFor, OPERATOR_SECTIONS } from '@/lib/navigation';
import {
  cmcStatusQuery,
  isReadiness,
  mergeRunPages,
  operatorKeys,
  readinessQuery,
  syncRunsQuery,
  upsertRun,
  type CmcStatus,
  type Readiness,
  type SyncRun,
  type SyncRunPage,
  type SyncRuns,
} from '@/lib/operator/queries';
import {
  averageCreditsPerRun,
  cmcAvailability,
  forecastQuota,
  nextMonthStart,
  quotaPercent,
  readSchedule,
  runDurationMs,
} from '@/lib/operator/system';
import {
  applyCoinDeleted,
  applyCoinSaved,
  describeAddFailure,
  describeFailure,
  parseAddForm,
  parseName,
  removeCoin,
  upsertCoin,
} from '@/lib/operator/watchlist';

const T0 = '2026-10-12T12:00:00.000Z';
const T1 = '2026-10-12T12:05:00.000Z';
const MINUTE = 60_000;

const coin = (overrides: Partial<Cryptocurrency> = {}): Cryptocurrency => ({
  id: 1,
  cmcId: 1,
  symbol: 'BTC',
  name: 'Bitcoin',
  isPaused: false,
  lastUpdatedAt: T0,
  createdAt: T0,
  updatedAt: T0,
  latestPrice: {
    price: '67123.45',
    currency: 'USD',
    sourceUpdatedAt: T0,
    fetchedAt: T0,
    change24hPercent: '1.23',
    isStale: false,
  },
  ...overrides,
});

const run = (overrides: Partial<SyncRun> = {}): SyncRun => ({
  id: 10,
  trigger: 'schedule',
  status: 'succeeded',
  startedAt: T0,
  finishedAt: '2026-10-12T12:00:02.100Z',
  coinsRequested: 3,
  pricesSaved: 3,
  attempts: 1,
  creditsUsed: 1,
  error: null,
  ...overrides,
});

const cmcStatus = (overrides: Partial<CmcStatus> = {}): CmcStatus => ({
  lastSuccessAt: T0,
  lastError: null,
  quota: {
    creditLimitMonthly: 10_000,
    creditsUsedMonth: 2_500,
    creditsLeftMonth: 7_500,
    creditsUsedToday: 120,
    fetchedAt: T0,
  },
  ...overrides,
});

const READY: Readiness = { status: 'ok', checks: { database: 'ok', migrations: 'ok', scheduler: 'running' } };

function problem(status: number, slug: string, extra: Partial<Problem> = {}, headers: Record<string, string> = {}) {
  return Response.json(
    { type: `urn:cpt:problem:${slug}`, title: 'Ошибка', status, requestId: 'req-1', ...extra },
    { status, headers: { 'content-type': 'application/problem+json', ...headers } },
  );
}

type Call = { url: string; method: string; headers: Headers; body: string | undefined; background: boolean };

function setupClient(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const onUnauthorized = jest.fn();
  const client = createBffClient({
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
        background: headers.has('x-cpt-background'),
      };
      calls.push(call);
      return Promise.resolve().then(() => reply(call));
    },
    onUnauthorized,
  });
  return { client, calls, onUnauthorized };
}

async function failure(client: BffClient, request = { symbol: 'BTC' }) {
  const error = await client.send('post', '/api/v1/cryptocurrencies', { body: request }).catch((e: unknown) => e);
  return describeAddFailure(error, request);
}

describe('[bff-client] запись', () => {
  it('✅ POST: JSON в теле, Content-Type и ответ 201 — объект из контракта', async () => {
    const { client, calls } = setupClient(() => Response.json(coin(), { status: 201 }));

    await expect(
      client.send('post', '/api/v1/cryptocurrencies', { body: { symbol: 'BTC', cmcId: 1 } }),
    ).resolves.toEqual(coin());
    expect(calls[0]).toMatchObject({ url: '/api/bff/api/v1/cryptocurrencies', method: 'POST', background: false });
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ symbol: 'BTC', cmcId: 1 });
  });

  it('✅ POST без тела (ручной запуск): Content-Type всё равно JSON — его требует защита BFF от CSRF', async () => {
    const { client, calls } = setupClient(() => Response.json(run({ status: 'running' }), { status: 202 }));

    await expect(client.send('post', '/api/v1/sync-runs', {})).resolves.toMatchObject({ status: 'running' });
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(calls[0]?.body).toBeUndefined();
  });

  it('✅ PATCH: параметр пути подставлен, тело — только изменяемое поле', async () => {
    const { client, calls } = setupClient(() => Response.json(coin({ isPaused: true })));

    await client.send('patch', '/api/v1/cryptocurrencies/{id}', { params: { id: 7 }, body: { isPaused: true } });
    expect(calls[0]).toMatchObject({ url: '/api/bff/api/v1/cryptocurrencies/7', method: 'PATCH' });
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ isPaused: true });
  });

  it('✅ DELETE: без тела и Content-Type, ответ 204 — undefined', async () => {
    const { client, calls } = setupClient(() => new Response(null, { status: 204 }));

    await expect(
      client.send('delete', '/api/v1/cryptocurrencies/{id}', { params: { id: 7 } }),
    ).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ url: '/api/bff/api/v1/cryptocurrencies/7', method: 'DELETE', body: undefined });
    expect(calls[0]?.headers.has('content-type')).toBe(false);
  });

  it('❌ 503 с Retry-After: секунды — в ошибке; заголовок с датой пропускается', async () => {
    const seconds = setupClient(() => problem(503, 'upstream-unavailable', {}, { 'retry-after': '45' }));
    const date = setupClient(() =>
      problem(503, 'upstream-unavailable', {}, { 'retry-after': 'Mon, 12 Oct 2026 12:00:00 GMT' }),
    );

    await expect(seconds.client.send('post', '/api/v1/sync-runs', {})).rejects.toMatchObject({
      status: 503,
      retryAfterSeconds: 45,
    });
    await expect(date.client.send('post', '/api/v1/sync-runs', {})).rejects.toMatchObject({ retryAfterSeconds: null });
  });

  it('❌ 401 при записи: вызывается выход на страницу входа', async () => {
    const { client, onUnauthorized } = setupClient(() => problem(401, 'unauthorized'));

    await expect(client.send('post', '/api/v1/sync-runs', {})).rejects.toBeInstanceOf(BffError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('❌ JSON, но не Problem: тело сохранено в ошибке, problem — null', async () => {
    const notReady = { status: 'fail', checks: { database: 'fail', migrations: 'fail', scheduler: 'stopped' } };
    const { client } = setupClient(() => Response.json(notReady, { status: 503 }));

    await expect(client.get('/health/ready')).rejects.toMatchObject({ status: 503, problem: null, body: notReady });
  });
});

describe('[operator/watchlist] форма добавления', () => {
  it('✅ символ приводится к верхнему регистру, пустой CMC ID в запрос не попадает', () => {
    expect(parseAddForm({ symbol: ' btc ', cmcId: '' })).toEqual({ ok: true, request: { symbol: 'BTC' } });
    expect(parseAddForm({ symbol: 'UNI', cmcId: ' 7083 ' })).toEqual({
      ok: true,
      request: { symbol: 'UNI', cmcId: 7083 },
    });
  });

  it.each([
    ['пустой символ', '', '', ['symbol']],
    ['кириллица', 'БТК', '', ['symbol']],
    ['длиннее 15 символов', 'A'.repeat(16), '', ['symbol']],
    ['дефис в символе', 'BTC-USD', '', ['symbol']],
    ['CMC ID не число', 'BTC', 'abc', ['cmcId']],
    ['CMC ID ноль', 'BTC', '0', ['cmcId']],
    ['CMC ID дробный', 'BTC', '1.5', ['cmcId']],
    ['обе ошибки сразу', '', '-1', ['symbol', 'cmcId']],
  ])('❌ %s — ошибка у поля, запроса нет', (_, symbol, cmcId, fields) => {
    const parsed = parseAddForm({ symbol, cmcId });
    expect(parsed.ok).toBe(false);
    expect(Object.keys(parsed.ok ? {} : parsed.fields)).toEqual(fields);
  });

  it('✅ имя: пробелы по краям срезаются; ❌ пустое и длиннее 100 символов', () => {
    expect(parseName('  Биткоин ')).toEqual({ ok: true, name: 'Биткоин' });
    expect(parseName('   ')).toMatchObject({ ok: false });
    expect(parseName('x'.repeat(101))).toMatchObject({ ok: false });
    expect(parseName('x'.repeat(100))).toMatchObject({ ok: true });
  });
});

describe('[operator/watchlist] отказ api при добавлении → сообщение формы (ui-flows §3.5)', () => {
  it('❌ 400: ошибки api — у своих полей', async () => {
    const errors = [
      { path: '/body/symbol', message: 'не соответствует шаблону' },
      { path: '/body/cmcId', message: 'должно быть ≥ 1' },
    ];
    const { client } = setupClient(() => problem(400, 'validation-error', { errors }));

    expect(await failure(client)).toMatchObject({
      fields: { symbol: 'не соответствует шаблону', cmcId: 'должно быть ≥ 1' },
      alert: null,
      requestId: 'req-1',
    });
  });

  it('❌ 400 не про поля формы: общее сообщение, а не молчание', async () => {
    const { client } = setupClient(() =>
      problem(400, 'validation-error', { detail: 'Лишнее поле', errors: [{ path: '/body/extra', message: 'лишнее' }] }),
    );

    expect(await failure(client)).toMatchObject({ fields: {}, alert: { tone: 'error', text: 'Лишнее поле' } });
  });

  it('❌ 409 already-tracked: сообщение у символа и id монеты для ссылки на карточку', async () => {
    const { client } = setupClient(() => problem(409, 'already-tracked', { conflictingId: 5 }));

    expect(await failure(client)).toMatchObject({
      fields: { symbol: 'BTC уже отслеживается' },
      conflictingId: 5,
      alert: null,
    });
  });

  it('❌ 422 unknown-symbol: подсказка зависит от того, был ли указан CMC ID', async () => {
    const { client } = setupClient(() => problem(422, 'unknown-symbol'));

    expect((await failure(client, { symbol: 'NOPE' })).fields.symbol).toContain('укажите CMC ID');
    expect((await failure(client, { symbol: 'NOPE', cmcId: 42 } as never)).fields.symbol).toContain('CMC ID 42');
  });

  it('❌ 422 watchlist-limit-reached: предупреждение формы, поля не отмечены', async () => {
    const { client } = setupClient(() => problem(422, 'watchlist-limit-reached'));

    expect(await failure(client)).toMatchObject({
      fields: {},
      alert: { tone: 'warn', title: 'Достигнут лимит: 100 монет' },
    });
  });

  it('❌ 503: CoinMarketCap недоступен, время повтора — из Retry-After, без заголовка — 30 с', async () => {
    const withHeader = setupClient(() => problem(503, 'upstream-unavailable', {}, { 'retry-after': '12' }));
    const withoutHeader = setupClient(() => problem(503, 'upstream-unavailable'));

    expect(await failure(withHeader.client)).toMatchObject({
      alert: { tone: 'error', title: 'CoinMarketCap недоступен' },
      retryAfterSeconds: 12,
    });
    expect((await failure(withoutHeader.client)).retryAfterSeconds).toBe(30);
  });

  it('❌ api не отвечает (502 от BFF) и сеть недоступна — разные сообщения, отсчёта повтора нет', async () => {
    const bff = setupClient(() =>
      Response.json({ type: 'urn:cpt:web:problem:upstream-unavailable', title: 'x', status: 502 }, { status: 502 }),
    );
    const network = setupClient(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await failure(bff.client)).toMatchObject({ alert: { title: 'API не отвечает' }, retryAfterSeconds: null });
    expect(await failure(network.client)).toMatchObject({ alert: { title: 'Нет связи с сервером' } });
  });

  it('❌ 403 и неизвестная ошибка', async () => {
    const forbidden = setupClient(() => problem(403, 'forbidden'));

    expect(await failure(forbidden.client)).toMatchObject({ alert: { title: 'Недостаточно прав' } });
    expect(describeAddFailure(new Error('boom'), { symbol: 'BTC' })).toMatchObject({
      alert: { title: 'Монета не добавлена' },
      requestId: null,
    });
  });

  it('✅ отказ остальных действий — одной строкой', () => {
    expect(describeFailure(new BffError(0, null))).toBe('Нет связи с сервером.');
    expect(describeFailure(new BffError(404, null))).toContain('удалили в другой вкладке');
    expect(describeFailure(new BffError(502, null))).toContain('API не отвечает');
    expect(
      describeFailure(
        new BffError(400, {
          type: 'urn:cpt:problem:validation-error',
          title: 'Ошибка',
          status: 400,
          errors: [{ path: '/body/name', message: 'слишком длинное' }],
        }),
      ),
    ).toBe('слишком длинное');
  });
});

describe('[operator/watchlist] результат мутации → кэш запросов', () => {
  const list = (): CryptocurrencyList => ({
    items: [coin(), coin({ id: 2, cmcId: 1027, symbol: 'ETH', name: 'Ethereum' })],
  });

  function setup() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(dashboardKeys.coins, list());
    queryClient.setQueryData(dashboardKeys.prices, { currency: 'USD', lastSync: null, items: [] });
    queryClient.setQueryData(dashboardKeys.sparklines('24h'), { window: '24h', items: [] });
    const coins = () => queryClient.getQueryData<CryptocurrencyList>(dashboardKeys.coins);
    const isStale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    return { queryClient, coins, isStale };
  }

  it('✅ новая монета встаёт по символу — как сортирует api; порядок остальных прежний', () => {
    const added = coin({
      id: 3,
      cmcId: 5805,
      symbol: 'AVAX',
      name: 'Avalanche',
      latestPrice: null,
      lastUpdatedAt: null,
    });

    expect(upsertCoin(list(), added).items.map((item) => item.symbol)).toEqual(['AVAX', 'BTC', 'ETH']);
    expect(upsertCoin(list(), coin({ name: 'Биткоин' })).items.map((item) => item.name)).toEqual([
      'Биткоин',
      'Ethereum',
    ]);
    expect(removeCoin(list(), 1).items.map((item) => item.symbol)).toEqual(['ETH']);
  });

  it('✅ сохранённая монета: список и карточка — из ответа api, цены и мини-графики помечены устаревшими', () => {
    const { queryClient, coins, isStale } = setup();
    const paused = coin({ isPaused: true });

    applyCoinSaved(queryClient, paused);

    expect(coins()?.items[0]).toEqual(paused);
    expect(queryClient.getQueryData(coinKeys.detail(1))).toEqual(paused);
    expect(isStale(dashboardKeys.prices)).toBe(true);
    expect(isStale(dashboardKeys.sparklines('24h'))).toBe(true);
  });

  it('✅ список ещё не загружен: кэш не выдумывается — первый ответ api принесёт монету сам', () => {
    const queryClient = new QueryClient();

    applyCoinSaved(queryClient, coin());

    expect(queryClient.getQueryData(dashboardKeys.coins)).toBeUndefined();
  });

  it('✅ удаление: строки нет, данные карточки убраны из кэша — api удалил их вместе с историей', () => {
    const { queryClient, coins, isStale } = setup();
    queryClient.setQueryData(coinKeys.detail(1), coin());
    queryClient.setQueryData(coinKeys.aggregates(1, '1h', '24h'), { buckets: [] });
    queryClient.setQueryData(coinKeys.history(1), { pages: [], pageParams: [] });
    queryClient.setQueryData(coinKeys.detail(2), coin({ id: 2 }));

    applyCoinDeleted(queryClient, 1);

    expect(coins()?.items.map((item) => item.id)).toEqual([2]);
    expect(queryClient.getQueryData(coinKeys.detail(1))).toBeUndefined();
    expect(queryClient.getQueryData(coinKeys.aggregates(1, '1h', '24h'))).toBeUndefined();
    expect(queryClient.getQueryData(coinKeys.history(1))).toBeUndefined();
    expect(queryClient.getQueryData(coinKeys.detail(2))).toBeDefined();
    expect(isStale(dashboardKeys.prices)).toBe(true);
  });

  it('✅ price.updated правит время последней цены в списке монет — без запроса', () => {
    const { queryClient, coins } = setup();
    const refresh = jest.fn();
    const event = { cryptocurrencyId: 2, price: '2500.1', currency: 'USD', sourceUpdatedAt: T1, fetchedAt: T1 };

    handleStreamEvent({ queryClient, refresh }, 'price.updated', JSON.stringify(event));

    expect(coins()?.items[1]).toMatchObject({ lastUpdatedAt: T1, latestPrice: { price: '2500.1', isStale: false } });
    expect(coins()?.items[0]).toEqual(coin());
  });
});

describe('[operator/queries] журнал запусков', () => {
  const page = (items: SyncRun[], nextCursor: string | null = null): SyncRunPage => ({ items, nextCursor });
  const data = (...pages: SyncRunPage[]): SyncRuns => ({ pages, pageParams: pages.map(() => null) });

  it('✅ запуск из ответа api — в начало первой страницы; остальные страницы не тронуты', () => {
    const older = page([run({ id: 8 })]);
    const next = upsertRun(data(page([run({ id: 10 })], 'c1'), older), run({ id: 11, status: 'running' }));

    expect(next?.pages[0]?.items.map((item) => item.id)).toEqual([11, 10]);
    expect(next?.pages[0]?.nextCursor).toBe('c1');
    expect(next?.pages[1]).toBe(older);
  });

  it('✅ запуск уже в журнале — заменяется на месте, дубля нет', () => {
    const next = upsertRun(data(page([run({ id: 11, status: 'running', finishedAt: null })])), run({ id: 11 }));

    expect(next?.pages[0]?.items).toEqual([run({ id: 11 })]);
  });

  it('✅ журнал ещё не загружен — остаётся как есть', () => {
    expect(upsertRun(undefined, run())).toBeUndefined();
  });

  it('✅ страницы склеиваются без дублей по id', () => {
    const pages = [page([run({ id: 11 }), run({ id: 10 })]), page([run({ id: 10 }), run({ id: 9 })])];

    expect(mergeRunPages(pages).map((item) => item.id)).toEqual([11, 10, 9]);
  });

  it('✅ sync.finished: перечитывается первая страница журнала — фоновым запросом', async () => {
    const { client, calls } = setupClient((call) =>
      Response.json(call.url.includes('cursor=c1') ? page([run({ id: 9 })]) : page([run({ id: 10 })], 'c1')),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new InfiniteQueryObserver(queryClient, { ...syncRunsQuery(client), staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    await queryClient.fetchInfiniteQuery(syncRunsQuery(client));
    await observer.fetchNextPage();
    expect(queryClient.getQueryData<SyncRuns>(operatorKeys.syncRuns)?.pages).toHaveLength(2);
    calls.length = 0;

    await refreshInBackground(queryClient, client, ['syncRuns']);
    unsubscribe();

    expect(calls.map(({ url, background }) => ({ url, background }))).toEqual([
      { url: '/api/bff/api/v1/sync-runs?limit=25', background: true },
    ]);
    expect(queryClient.getQueryData<SyncRuns>(operatorKeys.syncRuns)?.pages).toHaveLength(1);
  });

  it('✅ состояние CMC и готовность: на экране — фоновый запрос, не на экране — только пометка «устарело»', async () => {
    const { client, calls } = setupClient((call) =>
      Response.json(call.url.endsWith('/health/ready') ? READY : cmcStatus()),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unsubscribe = new QueryObserver(queryClient, { ...cmcStatusQuery(client), staleTime: Infinity }).subscribe(
      () => {},
    );
    await queryClient.fetchQuery(cmcStatusQuery(client));
    await queryClient.fetchQuery(readinessQuery(client));
    await queryClient.fetchQuery(coinsQuery(client));
    calls.length = 0;

    await refreshInBackground(queryClient, client, ['cmc', 'readiness']);
    unsubscribe();

    expect(calls.map(({ url, background }) => ({ url, background }))).toEqual([
      { url: '/api/bff/api/v1/system/cmc', background: true },
    ]);
    expect(queryClient.getQueryState(operatorKeys.readiness)?.isInvalidated).toBe(true);
  });
});

describe('[operator/queries] готовность сервиса', () => {
  const NOT_READY: Readiness = { status: 'fail', checks: { database: 'ok', migrations: 'fail', scheduler: 'stopped' } };

  it('✅ 503 с составом проверок — данные, а не ошибка: экран покажет, что именно не готово', async () => {
    const { client } = setupClient(() => Response.json(NOT_READY, { status: 503 }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(queryClient.fetchQuery(readinessQuery(client))).resolves.toEqual(NOT_READY);
  });

  it('❌ 502 от BFF (api не отвечает) и 503 без проверок остаются ошибкой', async () => {
    const gateway = setupClient(() =>
      Response.json({ type: 'urn:cpt:web:problem:upstream-unavailable', title: 'x', status: 502 }, { status: 502 }),
    );
    const garbage = setupClient(() => Response.json({ status: 'fail' }, { status: 503 }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(queryClient.fetchQuery(readinessQuery(gateway.client))).rejects.toMatchObject({ status: 502 });
    queryClient.clear();
    await expect(queryClient.fetchQuery(readinessQuery(garbage.client))).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    ['null', null],
    ['нет checks', { status: 'ok' }],
    [
      'незнакомое значение проверки',
      { status: 'ok', checks: { database: 'maybe', migrations: 'ok', scheduler: 'running' } },
    ],
    [
      'незнакомое состояние планировщика',
      { status: 'ok', checks: { database: 'ok', migrations: 'ok', scheduler: 'idle' } },
    ],
  ])('❌ форма не та: %s', (_, body) => {
    expect(isReadiness(body)).toBe(false);
  });

  it('✅ форма контракта принимается', () => {
    expect(isReadiness(READY)).toBe(true);
  });
});

describe('[operator/system] доступность CoinMarketCap и квота', () => {
  const error = (at: string) => ({ code: 'CMC_TIMEOUT', message: 'нет ответа', at });

  it.each([
    ['обращений ещё не было', { lastSuccessAt: null, lastError: null }, 'unknown'],
    ['ошибок не было', { lastSuccessAt: T0, lastError: null }, 'available'],
    ['успеха ещё не было, ошибка есть', { lastSuccessAt: null, lastError: error(T0) }, 'unavailable'],
    ['ошибка новее успеха', { lastSuccessAt: T0, lastError: error(T1) }, 'unavailable'],
    ['после ошибки был успех', { lastSuccessAt: T1, lastError: error(T0) }, 'available'],
  ])('✅ %s', (_, status, expected) => {
    expect(cmcAvailability(status)).toBe(expected);
  });

  it('✅ доля квоты: округление, потолок 100, лимит 0 — тоже 100', () => {
    expect(quotaPercent({ creditsUsedMonth: 2_500, creditLimitMonthly: 10_000 })).toBe(25);
    expect(quotaPercent({ creditsUsedMonth: 12_000, creditLimitMonthly: 10_000 })).toBe(100);
    expect(quotaPercent({ creditsUsedMonth: 0, creditLimitMonthly: 0 })).toBe(100);
  });

  it('✅ средний расход — по запускам с известным расходом; без них — null', () => {
    const runs = [
      run({ creditsUsed: 2 }),
      run({ creditsUsed: null }),
      run({ creditsUsed: 0 }),
      run({ creditsUsed: 1 }),
    ];

    expect(averageCreditsPerRun(runs)).toBe(1.5);
    expect(averageCreditsPerRun([run({ creditsUsed: null })])).toBeNull();
    expect(averageCreditsPerRun([])).toBeNull();
  });

  it('✅ длительность запуска; идущий запуск — null', () => {
    expect(runDurationMs(run())).toBe(2100);
    expect(runDurationMs(run({ finishedAt: null }))).toBeNull();
  });
});

describe('[operator/system] расписание и прогноз квоты (ADR 0017, 1D)', () => {
  const schedule = { state: 'running', intervalMs: 5 * MINUTE, nextRunAt: T1 };

  it('✅ api 1.1.0: блок schedule прочитан', () => {
    expect(readSchedule({ ...cmcStatus(), schedule })).toEqual(schedule);
    expect(readSchedule({ ...cmcStatus(), schedule: { ...schedule, nextRunAt: null } })?.nextRunAt).toBeNull();
  });

  it('✅ api 1.0.0: блока нет — null, интерфейс расписание не показывает', () => {
    expect(readSchedule(cmcStatus())).toBeNull();
    expect(readSchedule(undefined)).toBeNull();
  });

  it.each([
    ['незнакомое состояние', { ...schedule, state: 'paused' }],
    ['интервал строкой', { ...schedule, intervalMs: '300000' }],
    ['интервал ноль', { ...schedule, intervalMs: 0 }],
    ['время не дата', { ...schedule, nextRunAt: 'скоро' }],
    ['время отсутствует', { state: 'running', intervalMs: 300_000 }],
  ])('❌ %s — блок не принимается', (_, broken) => {
    expect(readSchedule({ schedule: broken })).toBeNull();
  });

  it('✅ конец месяца — по UTC, декабрь переходит в январь следующего года', () => {
    expect(nextMonthStart(Date.parse('2026-10-12T12:00:00.000Z'))).toBe(Date.parse('2026-11-01T00:00:00.000Z'));
    expect(nextMonthStart(Date.parse('2026-12-31T23:59:59.000Z'))).toBe(Date.parse('2027-01-01T00:00:00.000Z'));
  });

  it('✅ квоты хватает: расход до конца месяца меньше остатка', () => {
    // До 1 ноября — ровно сутки: 288 запусков по 5 минут, по 1 кредиту
    const now = Date.parse('2026-10-31T00:00:00.000Z');

    expect(forecastQuota({ creditsLeftMonth: 288, intervalMs: 5 * MINUTE, creditsPerRun: 1, now })).toEqual({
      needed: 288,
      enough: true,
      runsOutAt: null,
    });
  });

  it('❌ квоты не хватает: названо время, когда кредиты кончатся', () => {
    const now = Date.parse('2026-10-31T00:00:00.000Z');
    const forecast = forecastQuota({ creditsLeftMonth: 144, intervalMs: 5 * MINUTE, creditsPerRun: 1, now });

    expect(forecast).toMatchObject({ needed: 288, enough: false });
    expect(new Date(forecast.runsOutAt ?? 0).toISOString()).toBe('2026-10-31T12:00:00.000Z');
  });

  it('✅ дробный средний расход округляется вверх — прогноз не занижается', () => {
    const now = Date.parse('2026-10-31T23:00:00.000Z');

    expect(forecastQuota({ creditsLeftMonth: 100, intervalMs: 5 * MINUTE, creditsPerRun: 1.3, now }).needed).toBe(16);
  });
});

describe('[format] счётчики, длительность, интервал', () => {
  it('✅ целое с разделителями разрядов', () => {
    expect(formatCount(15000).replace(/\s/g, ' ')).toBe('15 000');
    expect(formatCount(0)).toBe('0');
  });

  it('✅ длительность: миллисекунды, секунды с десятыми, минуты', () => {
    expect(formatDuration(850)).toBe('850 мс');
    expect(formatDuration(2100)).toBe('2,1 с');
    expect(formatDuration(65_000)).toBe('1 мин 05 с');
  });

  it('✅ интервал расписания словами', () => {
    expect(formatInterval(300_000)).toBe('каждые 5 мин');
    expect(formatInterval(7_200_000)).toBe('каждые 2 ч');
    expect(formatInterval(90_000)).toBe('каждые 90 с');
  });
});

describe('[navigation] разделы оператора', () => {
  it('✅ пункт «Оператор» виден только оператору и активен на всех своих разделах', () => {
    expect(navItemsFor('viewer').map((item) => item.href)).toEqual(['/']);
    expect(navItemsFor('operator').map((item) => item.href)).toEqual(['/', '/operator']);
    for (const section of OPERATOR_SECTIONS) expect(isActivePath(section.href, '/operator')).toBe(true);
    expect(isActivePath('/operators', '/operator')).toBe(false);
  });
});
