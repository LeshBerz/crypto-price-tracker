import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { BffError, createBffClient, type BffClient } from '@/lib/bff-client';
import {
  dashboardKeys,
  pricesQuery,
  refreshInBackground,
  sparklinesQuery,
  type LatestPriceList,
  type RefreshTarget,
} from '@/lib/dashboard/queries';
import { connectStream, reconnectDelay, type StreamSource, type StreamStatus } from '@/lib/dashboard/stream-connection';
import { applyPriceUpdate, handleStreamEvent, parseStreamEvent, type PriceUpdate } from '@/lib/dashboard/stream-events';

const T0 = '2026-10-12T12:00:00.000Z';
const T1 = '2026-10-12T12:05:00.000Z';

function priceList(): LatestPriceList {
  return {
    currency: 'USD',
    lastSync: { id: 10, status: 'succeeded', finishedAt: T0 },
    items: [
      {
        cryptocurrencyId: 1,
        symbol: 'BTC',
        name: 'Bitcoin',
        latest: {
          price: '67123.45',
          currency: 'USD',
          sourceUpdatedAt: T0,
          fetchedAt: T0,
          change24hPercent: '1.23',
          isStale: true,
        },
      },
      { cryptocurrencyId: 2, symbol: 'PEPE', name: 'Pepe', latest: null },
    ],
  };
}

const update = (overrides: Partial<PriceUpdate> = {}): PriceUpdate => ({
  cryptocurrencyId: 1,
  price: '67130.1',
  currency: 'USD',
  sourceUpdatedAt: T1,
  fetchedAt: T1,
  ...overrides,
});

describe('[stream-events] разбор события', () => {
  it('✅ price.updated → новая цена', () => {
    expect(parseStreamEvent('price.updated', JSON.stringify({ ...update(), symbol: 'BTC' }))).toEqual({
      type: 'price',
      update: update(),
    });
  });

  it('✅ sync.finished → цены, мини-графики, монета и её график; watchlist.changed → списки и монета', () => {
    expect(parseStreamEvent('sync.finished', '{"id":11,"status":"failed"}')).toEqual({
      type: 'refresh',
      targets: ['prices', 'sparklines', 'coin', 'aggregates'],
    });
    expect(parseStreamEvent('watchlist.changed', '{"cryptocurrencyId":3,"change":"added"}')).toEqual({
      type: 'refresh',
      targets: ['prices', 'sparklines', 'coins', 'coin'],
    });
  });

  it.each([
    ['битый JSON', 'price.updated', '{oops'],
    ['цена числом, а не строкой', 'price.updated', JSON.stringify({ ...update(), price: 67130.1 })],
    ['нет fetchedAt', 'price.updated', JSON.stringify({ ...update(), fetchedAt: undefined })],
    ['null вместо объекта', 'price.updated', 'null'],
    ['heartbeat', 'heartbeat', '{}'],
    ['незнакомое событие', 'something.new', '{}'],
  ])('❌ %s — событие пропускается', (_, name, raw) => {
    expect(parseStreamEvent(name, raw)).toEqual({ type: 'ignore' });
  });
});

describe('[stream-events] новая цена в списке', () => {
  it('✅ цена и время обновлены, isStale снят, изменение за 24 ч и порядок строк прежние', () => {
    const before = priceList();
    const applied = applyPriceUpdate(before, update());

    expect(applied?.direction).toBe('up');
    expect(applied?.list.items.map((item) => item.symbol)).toEqual(['BTC', 'PEPE']);
    expect(applied?.list.items[0]?.latest).toEqual({
      price: '67130.1',
      currency: 'USD',
      sourceUpdatedAt: T1,
      fetchedAt: T1,
      change24hPercent: '1.23',
      isStale: false,
    });
    // Кэш не мутируется: React видит новый объект, прежний остаётся как был
    expect(before.items[0]?.latest?.price).toBe('67123.45');
    expect(applied?.list).not.toBe(before);
  });

  it('✅ направление: дешевле — down, та же цена — flat', () => {
    expect(applyPriceUpdate(priceList(), update({ price: '67000' }))?.direction).toBe('down');
    expect(applyPriceUpdate(priceList(), update({ price: '67123.45' }))?.direction).toBe('flat');
  });

  it('✅ первая цена монеты (latest = null): изменение за 24 ч неизвестно, подсветки нет', () => {
    const applied = applyPriceUpdate(priceList(), update({ cryptocurrencyId: 2, price: '0.0000123' }));

    expect(applied?.direction).toBe('flat');
    expect(applied?.list.items[1]?.latest).toMatchObject({ price: '0.0000123', change24hPercent: null });
  });

  it('❌ событие старше цены в списке не затирает её', () => {
    const before = priceList();
    const applied = applyPriceUpdate(before, update({ fetchedAt: '2026-10-12T11:55:00.000Z' }));

    expect(applied?.list).toBe(before);
  });

  it('❌ монеты нет в списке → null', () => {
    expect(applyPriceUpdate(priceList(), update({ cryptocurrencyId: 99 }))).toBeNull();
  });
});

describe('[stream-events] событие → кэш запросов', () => {
  function setup(initial: LatestPriceList | null = priceList()) {
    const queryClient = new QueryClient();
    if (initial) queryClient.setQueryData(dashboardKeys.prices, initial);
    const refresh = jest.fn<undefined, [readonly RefreshTarget[]]>();
    const onPriceChange = jest.fn();
    const send = (name: string, data: unknown) =>
      handleStreamEvent({ queryClient, refresh, onPriceChange }, name, JSON.stringify(data));
    const prices = () => queryClient.getQueryData<LatestPriceList>(dashboardKeys.prices);
    return { send, prices, refresh, onPriceChange };
  }

  it('✅ price.updated пишет цену в кэш без запроса и сообщает направление', () => {
    const { send, prices, refresh, onPriceChange } = setup();
    send('price.updated', update());

    expect(prices()?.items[0]?.latest?.price).toBe('67130.1');
    expect(refresh).not.toHaveBeenCalled();
    expect(onPriceChange).toHaveBeenCalledWith(1, 'up');
  });

  it('✅ незнакомая монета → перезапрос списка (страховка от потерянного watchlist.changed)', () => {
    const { send, refresh, onPriceChange } = setup();
    send('price.updated', update({ cryptocurrencyId: 99 }));

    expect(refresh).toHaveBeenCalledWith(['prices', 'coins']);
    expect(onPriceChange).not.toHaveBeenCalled();
  });

  it('✅ sync.finished → перезапрос, а не правка кэша', () => {
    const { send, prices, refresh } = setup();
    send('sync.finished', { id: 11, status: 'succeeded' });

    expect(refresh).toHaveBeenCalledWith(['prices', 'sparklines', 'coin', 'aggregates']);
    expect(prices()).toEqual(priceList());
  });

  it('✅ список ещё не загружен — событие цены пропускается', () => {
    const { send, prices, refresh } = setup(null);
    send('price.updated', update());

    expect(prices()).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('[queries] фоновый перезапрос', () => {
  type Seen = { url: string; background: boolean };

  function setup(reply: (url: string) => Response) {
    const seen: Seen[] = [];
    const client: BffClient = createBffClient({
      fetch: (input, init) => {
        seen.push({ url: String(input), background: new Headers(init?.headers).has('x-cpt-background') });
        return Promise.resolve(reply(String(input)));
      },
      onUnauthorized: jest.fn(),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { seen, client, queryClient };
  }

  /** Запрос на экране: у него есть наблюдатель */
  function observe(queryClient: QueryClient, client: BffClient) {
    return new QueryObserver(queryClient, { ...pricesQuery(client), staleTime: Infinity }).subscribe(() => {});
  }

  it('✅ запрос идёт с признаком фона, результат попадает в тот же ключ кэша', async () => {
    const { seen, client, queryClient } = setup(() => Response.json(priceList()));
    const unsubscribe = observe(queryClient, client);
    await queryClient.fetchQuery(pricesQuery(client));
    seen.length = 0;

    await refreshInBackground(queryClient, client, ['prices']);
    unsubscribe();

    expect(seen).toEqual([{ url: '/api/bff/api/v1/prices', background: true }]);
    expect(queryClient.getQueryData(dashboardKeys.prices)).toEqual(priceList());
  });

  it('✅ данных нет на экране: запрос не уходит, загруженное помечается устаревшим', async () => {
    const { seen, client, queryClient } = setup(() => Response.json(priceList()));
    await refreshInBackground(queryClient, client, ['prices']);
    expect(seen).toEqual([]);

    await queryClient.fetchQuery(pricesQuery(client));
    seen.length = 0;
    await refreshInBackground(queryClient, client, ['prices', 'coins']);

    expect(seen).toEqual([]);
    expect(queryClient.getQueryState(dashboardKeys.prices)?.isInvalidated).toBe(true);
  });

  it('✅ проба: поток отказал, а на экране запросов нет — причину покажет запрос цен', async () => {
    const { seen, client, queryClient } = setup(() => Response.json(priceList()));
    await refreshInBackground(queryClient, client, ['prices', 'coin'], { probe: true });

    expect(seen).toEqual([{ url: '/api/bff/api/v1/prices', background: true }]);
  });

  it('✅ наблюдатель запроса видит новые данные, а его собственный перезапрос остаётся обычным', async () => {
    const { seen, client, queryClient } = setup(() => Response.json(priceList()));
    const observer = new QueryObserver(queryClient, pricesQuery(client));
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    await refreshInBackground(queryClient, client, ['prices']);
    await observer.refetch();
    unsubscribe();

    expect(seen.map((call) => call.background)).toEqual([false, true, false]);
  });

  it('✅ мини-графики: перечитывается окно на экране, скрытое — только помечается устаревшим', async () => {
    const { seen, client, queryClient } = setup((url) =>
      Response.json({ currency: 'USD', window: url.includes('7d') ? '7d' : '24h', interval: '1h', items: [] }),
    );
    const visible = new QueryObserver(queryClient, { ...sparklinesQuery(client, '24h'), staleTime: Infinity });
    const unsubscribe = visible.subscribe(() => {});
    await visible.refetch();
    await queryClient.fetchQuery({ ...sparklinesQuery(client, '7d'), staleTime: Infinity });
    seen.length = 0;

    await refreshInBackground(queryClient, client, ['sparklines']);
    unsubscribe();

    expect(seen).toEqual([{ url: '/api/bff/api/v1/prices/sparklines?window=24h', background: true }]);
    expect(queryClient.getQueryState(dashboardKeys.sparklines('7d'))?.isInvalidated).toBe(true);
  });

  it('❌ api недоступен: прежние данные остаются, ошибка — в состоянии запроса', async () => {
    let fail = false;
    const { client, queryClient } = setup(() =>
      fail
        ? Response.json(
            { type: 'urn:cpt:web:problem:upstream-unavailable', title: 'Bad Gateway', status: 502, requestId: 'r-502' },
            { status: 502, headers: { 'content-type': 'application/problem+json' } },
          )
        : Response.json(priceList()),
    );
    const unsubscribe = observe(queryClient, client);
    await queryClient.fetchQuery(pricesQuery(client));
    fail = true;

    await expect(refreshInBackground(queryClient, client, ['prices'])).resolves.toBeUndefined();
    unsubscribe();

    const state = queryClient.getQueryState(dashboardKeys.prices);
    expect(state?.data).toEqual(priceList());
    expect(state?.error).toBeInstanceOf(BffError);
    expect(state?.error).toMatchObject({ status: 502, requestId: 'r-502' });
  });
});

describe('[stream-connection] соединение с потоком', () => {
  class FakeSource implements StreamSource {
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    closed = false;
    private listeners = new Map<string, (event: MessageEvent<string>) => void>();

    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
      this.listeners.set(type, listener);
    }
    close(): void {
      this.closed = true;
      this.readyState = 2;
    }
    open(): void {
      this.readyState = 1;
      this.onopen?.({} as Event);
    }
    /** Обрыв сети: браузер переподключается сам, readyState = CONNECTING */
    drop(): void {
      this.readyState = 0;
      this.onerror?.({} as Event);
    }
    /** Сервер ответил ошибкой HTTP: браузер больше не пробует, readyState = CLOSED */
    reject(): void {
      this.readyState = 2;
      this.onerror?.({} as Event);
    }
    emit(type: string, data = '{}'): void {
      this.listeners.get(type)?.({ data } as MessageEvent<string>);
    }
  }

  function setup() {
    const sources: FakeSource[] = [];
    const statuses: StreamStatus[] = [];
    const handlers = {
      onEvent: jest.fn(),
      onReopen: jest.fn(),
      onGiveUp: jest.fn(),
      onSessionExpired: jest.fn(),
    };
    const stop = connectStream({
      createSource: () => {
        const source = new FakeSource();
        sources.push(source);
        return source;
      },
      onStatus: (status) => statuses.push(status),
      ...handlers,
    });
    const last = () => sources[sources.length - 1] as FakeSource;
    return { sources, statuses, stop, last, ...handlers };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('✅ первое открытие: статус open, перезапроса нет', () => {
    const { statuses, last, onReopen } = setup();
    last().open();

    expect(statuses).toEqual(['connecting', 'open']);
    expect(onReopen).not.toHaveBeenCalled();
  });

  it('✅ события api передаются обработчику с именем и данными; heartbeat — нет', () => {
    const { last, onEvent } = setup();
    last().open();
    last().emit('price.updated', '{"price":"1"}');
    last().emit('heartbeat');

    expect(onEvent.mock.calls).toEqual([['price.updated', '{"price":"1"}']]);
  });

  it('✅ обрыв сети: браузер переподключается сам, после открытия состояние перечитывается', () => {
    const { sources, statuses, last, onReopen, onGiveUp } = setup();
    last().open();
    last().drop();
    last().open();

    expect(sources).toHaveLength(1);
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);
    expect(onReopen).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('✅ сервер ответил ошибкой: новая попытка — с растущей задержкой, до 30 с', () => {
    const { sources, last, onGiveUp } = setup();
    last().reject();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(sources[0]?.closed).toBe(true);

    jest.advanceTimersByTime(999);
    expect(sources).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);

    last().reject();
    jest.advanceTimersByTime(1999);
    expect(sources).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(sources).toHaveLength(3);

    expect([0, 1, 2, 3, 4, 5, 6, 50].map(reconnectDelay)).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it('✅ поток открылся после неудачных попыток: задержка сброшена, состояние перечитано', () => {
    const { sources, last, onReopen } = setup();
    last().reject();
    jest.advanceTimersByTime(1000);
    last().reject();
    jest.advanceTimersByTime(2000);
    last().open();
    expect(onReopen).toHaveBeenCalledTimes(1);

    last().reject();
    jest.advanceTimersByTime(1000);
    expect(sources).toHaveLength(4);
  });

  it('✅ session.expired: поток закрыт, новых попыток нет, вызван выход', () => {
    const { sources, last, onSessionExpired } = setup();
    last().open();
    last().emit('session.expired');
    last().reject();
    jest.advanceTimersByTime(60_000);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.closed).toBe(true);
  });

  it('✅ остановка (уход с экрана) закрывает поток и отменяет запланированную попытку', () => {
    const { sources, stop, last } = setup();
    last().reject();
    stop();
    jest.advanceTimersByTime(60_000);

    expect(sources).toHaveLength(1);
  });
});
