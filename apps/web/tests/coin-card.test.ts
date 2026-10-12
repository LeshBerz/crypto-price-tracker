import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { createBffClient, type BffClient } from '@/lib/bff-client';
import { planSeriesUpdate, priceStep, toChartPoints, type ChartPoint } from '@/lib/coin/chart-data';
import {
  bucketCount,
  bucketStartOf,
  comboIssue,
  INTERVALS,
  periodFrom,
  PERIODS,
  type Interval,
  type Period,
} from '@/lib/coin/intervals';
import {
  applyPriceToAggregates,
  applyPriceToCoin,
  prependHistoryPoint,
  type PriceUpdate,
} from '@/lib/coin/live-updates';
import {
  aggregatesQuery,
  coinKeys,
  coinQuery,
  historyQuery,
  mergeHistoryPages,
  type Cryptocurrency,
  type PriceAggregates,
  type PriceBucket,
  type PriceHistory,
  type PriceHistoryPage,
} from '@/lib/coin/queries';
import { refreshInBackground } from '@/lib/dashboard/queries';
import { handleStreamEvent } from '@/lib/dashboard/stream-events';
import { formatAxisPrice, formatUtc } from '@/lib/format';

const iso = (text: string) => `2026-10-12T${text}.000Z`;
const seconds = (text: string) => Date.parse(iso(text)) / 1000;

function bucket(start: string, open: string, close: string, min = open, max = close): PriceBucket {
  return { bucketStart: iso(start), stats: { open, close, min, max, avg: open, changePercent: '0.1', points: 12 } };
}

function aggregates(buckets: PriceBucket[], interval: Interval = '1h'): PriceAggregates {
  return {
    cryptocurrencyId: 1,
    currency: 'USD',
    interval,
    from: '2026-10-05T12:00:00.000Z',
    to: iso('12:30:00'),
    summary: { open: '100', close: '104', min: '99', max: '106', avg: '102.5', changePercent: '4', points: 36 },
    buckets,
  };
}

const update = (overrides: Partial<PriceUpdate> = {}): PriceUpdate => ({
  cryptocurrencyId: 1,
  price: '105',
  currency: 'USD',
  sourceUpdatedAt: iso('12:34:19'),
  fetchedAt: iso('12:35:00'),
  ...overrides,
});

function coin(): Cryptocurrency {
  return {
    id: 1,
    cmcId: 1,
    symbol: 'BTC',
    name: 'Bitcoin',
    isPaused: false,
    lastUpdatedAt: iso('12:30:00'),
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    latestPrice: {
      price: '104',
      currency: 'USD',
      sourceUpdatedAt: iso('12:29:19'),
      fetchedAt: iso('12:30:00'),
      change24hPercent: '1.5',
      isStale: true,
    },
  };
}

function page(times: string[], nextCursor: string | null = null): PriceHistoryPage {
  return {
    cryptocurrencyId: 1,
    currency: 'USD',
    items: times.map((time) => ({ price: '104', sourceUpdatedAt: iso(time), fetchedAt: iso(time) })),
    nextCursor,
  };
}

describe('[intervals] интервал × период', () => {
  it('✅ недоступны сочетания больше 1000 бакетов и меньше двух — остальные доступны', () => {
    const blocked = INTERVALS.flatMap((interval) =>
      PERIODS.filter((period) => comboIssue(interval, period) !== null).map((period) => `${interval}×${period}`),
    );

    expect(blocked).toEqual(['1h×1y', '4h×1y', '1d×24h', '1w×24h', '1w×7d']);
  });

  it('✅ причина называет число бакетов и подсказывает, что выбрать', () => {
    expect(bucketCount('1h', '1y')).toBe(8760);
    expect(comboIssue('1h', '1y')).toMatch(/8\s760 бакетов, больше предела 1000/);
    expect(comboIssue('1d', '24h')).toMatch(/меньше двух бакетов/);
    expect(comboIssue('1h', '7d')).toBeNull();
  });

  it('✅ начало бакета: UTC, неделя — с понедельника', () => {
    const moment = Date.parse('2026-10-15T13:47:11.000Z'); // четверг
    const start = (interval: Interval) => new Date(bucketStartOf(moment, interval)).toISOString();

    expect(start('1h')).toBe('2026-10-15T13:00:00.000Z');
    expect(start('4h')).toBe('2026-10-15T12:00:00.000Z');
    expect(start('1d')).toBe('2026-10-15T00:00:00.000Z');
    expect(start('1w')).toBe('2026-10-12T00:00:00.000Z');
    expect(new Date(bucketStartOf(Date.parse('2026-10-12T00:00:00.000Z'), '1w')).getUTCDay()).toBe(1);
  });

  it('✅ начало периода выровнено по бакету, а запрос с запасом на него остаётся в пределе api', () => {
    const now = Date.parse('2026-10-15T13:47:11.000Z');
    expect(periodFrom(now, '1h', '7d')).toBe('2026-10-08T13:00:00.000Z');
    expect(periodFrom(now, '1w', '30d')).toBe('2026-09-14T00:00:00.000Z');

    const allowed = INTERVALS.flatMap((interval) =>
      PERIODS.filter((period) => comboIssue(interval, period) === null).map((period) => [interval, period] as const),
    );
    for (const [interval, period] of allowed) {
      // Выравнивание добавляет к периоду меньше одного бакета
      expect(bucketCount(interval, period) + 1).toBeLessThanOrEqual(1000);
    }
  });
});

describe('[chart-data] бакеты → точки графика', () => {
  it('✅ свеча: open / max / min / close бакета, время — секунды Unix', () => {
    expect(toChartPoints([bucket('10:00:00', '100', '104', '99', '106')], '1h', 'candles')).toEqual([
      { time: seconds('10:00:00'), open: 100, high: 106, low: 99, close: 104 },
    ]);
  });

  it('✅ линия — по цене закрытия', () => {
    expect(toChartPoints([bucket('10:00:00', '100', '104')], '1h', 'line')).toEqual([
      { time: seconds('10:00:00'), value: 104 },
    ]);
  });

  it('✅ пропущенные бакеты занимают место на шкале, но ничего не рисуют', () => {
    const points = toChartPoints([bucket('08:00:00', '100', '101'), bucket('11:00:00', '103', '104')], '1h', 'line');

    expect(points).toEqual([
      { time: seconds('08:00:00'), value: 101 },
      { time: seconds('09:00:00') },
      { time: seconds('10:00:00') },
      { time: seconds('11:00:00'), value: 104 },
    ]);
  });

  it('✅ мелкая цена не превращается в ноль', () => {
    const [point] = toChartPoints([bucket('10:00:00', '0.0000000012345678901234', '0.0000000012345')], '1h', 'line');

    expect(point).toEqual({ time: seconds('10:00:00'), value: 1.2345e-9 });
  });

  it('✅ шаг шкалы: цент для цен от 1, шестая значащая цифра — для мелких', () => {
    expect(priceStep('67123.45')).toBe(0.01);
    expect(priceStep('0.5')).toBe(1e-6);
    expect(priceStep('0.0000000012345678901234')).toBe(1e-14);
  });

  it('✅ подписи шкалы: те же правила, что у цен на экране', () => {
    expect(formatAxisPrice(67123.4)).toBe('$67,123.40');
    expect(formatAxisPrice(0.5)).toBe('$0.50');
    expect(formatAxisPrice(1.2345678e-9)).toBe('$0.00000000123457');
    expect(formatUtc(Date.parse(iso('14:00:00')))).toBe('12.10.2026, 14:00 UTC');
  });
});

describe('[chart-data] обновление нарисованного ряда', () => {
  const a: ChartPoint = { time: 1, value: 10 };
  const b: ChartPoint = { time: 2, value: 11 };

  it('✅ первая отрисовка и другой период — полная замена', () => {
    expect(planSeriesUpdate([], [a, b])).toEqual({ type: 'reset' });
    expect(planSeriesUpdate([a, b], [b, { time: 3, value: 12 }])).toEqual({ type: 'reset' });
    expect(planSeriesUpdate([a, b], [a])).toEqual({ type: 'reset' });
  });

  it('✅ изменилась последняя точка → series.update только для неё', () => {
    const changed = { time: 2, value: 12 };
    expect(planSeriesUpdate([a, b], [a, changed])).toEqual({ type: 'update', points: [changed] });
  });

  it('✅ новая точка справа (и пропуск перед ней) дописывается, прежние не трогаются', () => {
    const gap = { time: 3 };
    const next = { time: 4, value: 13 };
    expect(planSeriesUpdate([a, b], [a, b, gap, next])).toEqual({ type: 'update', points: [gap, next] });
  });

  it('✅ данные те же — график не трогается', () => {
    expect(planSeriesUpdate([a, b], [{ ...a }, { ...b }])).toEqual({ type: 'none' });
    expect(planSeriesUpdate([], [])).toEqual({ type: 'none' });
  });

  it('❌ правка в середине ряда → полная замена', () => {
    expect(planSeriesUpdate([a, b], [{ time: 1, value: 9 }, b])).toEqual({ type: 'reset' });
  });
});

describe('[live-updates] price.updated → данные карточки', () => {
  const before = aggregates([bucket('11:00:00', '100', '102'), bucket('12:00:00', '102', '104', '101', '104.5')]);

  it('✅ цена в текущем бакете: закрытие и максимум обновлены, остальное — как у сервера', () => {
    const after = applyPriceToAggregates(before, update({ price: '105' }));

    expect(after.buckets[1]?.stats).toEqual({ ...before.buckets[1]?.stats, close: '105', max: '105' });
    expect(after.buckets[0]).toBe(before.buckets[0]);
    // Сводку и среднее считает сервер: до sync.finished они прежние
    expect(after.summary).toBe(before.summary);
    expect(before.buckets[1]?.stats.close).toBe('104');
  });

  it('✅ новый минимум сравнивается как десятичная строка, а не число', () => {
    const tiny = aggregates([bucket('12:00:00', '0.0000000012345678901234', '0.0000000012345678901234')]);
    const after = applyPriceToAggregates(tiny, update({ price: '0.0000000012345678901233' }));

    expect(after.buckets[0]?.stats).toMatchObject({
      min: '0.0000000012345678901233',
      max: '0.0000000012345678901234',
      close: '0.0000000012345678901233',
    });
  });

  it('✅ начался новый час — открывается новая свеча', () => {
    const after = applyPriceToAggregates(before, update({ fetchedAt: iso('13:00:05') }));

    expect(after.buckets).toHaveLength(3);
    expect(after.buckets[2]).toEqual({
      bucketStart: iso('13:00:00'),
      stats: { open: '105', close: '105', min: '105', max: '105', avg: '105', changePercent: '0', points: 1 },
    });
  });

  it('✅ интервал берётся из ответа: в графике по 4 ч та же цена попадает в бакет 12:00', () => {
    const fourHours = aggregates([bucket('08:00:00', '100', '102'), bucket('12:00:00', '102', '104')], '4h');

    expect(applyPriceToAggregates(fourHours, update({ fetchedAt: iso('15:59:59') })).buckets).toHaveLength(2);
    expect(applyPriceToAggregates(fourHours, update({ fetchedAt: iso('16:00:00') })).buckets).toHaveLength(3);
  });

  it('✅ первая цена монеты: график начинается с одной свечи', () => {
    expect(applyPriceToAggregates(aggregates([]), update()).buckets).toHaveLength(1);
  });

  it('❌ событие из прошлого бакета и повтор той же цены данные не меняют', () => {
    expect(applyPriceToAggregates(before, update({ fetchedAt: iso('11:59:00') }))).toBe(before);
    expect(applyPriceToAggregates(before, update({ price: '104' }))).toBe(before);
  });

  it('✅ монета: цена и время обновлены, «устарела» снято, изменение за 24 ч прежнее', () => {
    const after = applyPriceToCoin(coin(), update());

    expect(after.latestPrice).toEqual({
      price: '105',
      currency: 'USD',
      sourceUpdatedAt: iso('12:34:19'),
      fetchedAt: iso('12:35:00'),
      change24hPercent: '1.5',
      isStale: false,
    });
    expect(after.lastUpdatedAt).toBe(iso('12:35:00'));
  });

  it('❌ монета: событие старше показанной цены пропускается', () => {
    const before = coin();
    expect(applyPriceToCoin(before, update({ fetchedAt: iso('12:00:00') }))).toBe(before);
  });
});

describe('[queries] история цен', () => {
  const history = (pages: PriceHistoryPage[]): PriceHistory => ({
    pages,
    pageParams: pages.map((_, index) => (index === 0 ? null : `c${index}`)),
  });

  it('✅ страницы сливаются по порядку, от новых к старым', () => {
    const points = mergeHistoryPages([page(['12:30:00', '12:25:00'], 'c1'), page(['12:20:00'])]);

    expect(points.map((point) => point.fetchedAt)).toEqual([iso('12:30:00'), iso('12:25:00'), iso('12:20:00')]);
  });

  it('✅ точка, пришедшая и из потока, и из api, показывается один раз', () => {
    const points = mergeHistoryPages([page(['12:30:00', '12:25:00'], 'c1'), page(['12:25:00', '12:20:00'])]);

    expect(points).toHaveLength(3);
  });

  it('✅ новая точка из потока — первой строкой, курсоры страниц не меняются', () => {
    const before = history([page(['12:30:00'], 'c1'), page(['12:20:00'])]);
    const after = prependHistoryPoint(before, update());

    expect(after.pages[0]?.items.map((point) => point.fetchedAt)).toEqual([iso('12:35:00'), iso('12:30:00')]);
    expect(after.pages[0]?.items[0]?.price).toBe('105');
    expect(after.pages[0]?.nextCursor).toBe('c1');
    expect(after.pages[1]).toBe(before.pages[1]);
    expect(after.pageParams).toBe(before.pageParams);
  });

  it('✅ у монеты ещё не было точек — первая появляется в пустой странице', () => {
    expect(prependHistoryPoint(history([page([])]), update()).pages[0]?.items).toHaveLength(1);
  });

  it('❌ повтор события и событие старше первой строки историю не меняют', () => {
    const before = history([page(['12:35:00'])]);

    expect(prependHistoryPoint(before, update({ sourceUpdatedAt: iso('12:35:00') }))).toBe(before);
    expect(prependHistoryPoint(before, update({ fetchedAt: iso('12:00:00') }))).toBe(before);
  });
});

describe('[queries] запросы карточки через BFF', () => {
  type Seen = { url: string; background: boolean };

  function setup(reply: (url: URL) => unknown) {
    const seen: Seen[] = [];
    const client: BffClient = createBffClient({
      fetch: (input, init) => {
        seen.push({ url: String(input), background: new Headers(init?.headers).has('x-cpt-background') });
        return Promise.resolve(Response.json(reply(new URL(String(input), 'http://web'))));
      },
      onUnauthorized: jest.fn(),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { seen, client, queryClient };
  }

  /** Три страницы по одной точке: курсор — номер следующей страницы */
  const pagedHistory = (url: URL) => {
    const index = Number(url.searchParams.get('cursor') ?? 0);
    return page([`12:${30 - index * 5}:00`], index < 2 ? String(index + 1) : null);
  };

  it('✅ агрегаты: интервал и выровненное начало периода в запросе, период — только в ключе', async () => {
    const { seen, client, queryClient } = setup(() => aggregates([]));
    const now = () => Date.parse('2026-10-15T13:47:11.000Z');
    await queryClient.fetchQuery(aggregatesQuery(client, 1, '1h', '7d', false, now));

    expect(seen).toEqual([
      {
        url: '/api/bff/api/v1/cryptocurrencies/1/prices/aggregates?interval=1h&from=2026-10-08T13%3A00%3A00.000Z',
        background: false,
      },
    ]);
    expect(queryClient.getQueryData(coinKeys.aggregates(1, '1h', '7d'))).toBeDefined();
  });

  it('✅ история: первая страница без курсора, следующая — с курсором из ответа', async () => {
    const { seen, client, queryClient } = setup(pagedHistory);
    const observer = new InfiniteQueryObserver(queryClient, historyQuery(client, 1));
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    await observer.fetchNextPage();
    const result = observer.getCurrentResult();
    unsubscribe();

    expect(seen.map((call) => call.url)).toEqual([
      '/api/bff/api/v1/cryptocurrencies/1/prices?limit=25',
      '/api/bff/api/v1/cryptocurrencies/1/prices?limit=25&cursor=1',
    ]);
    expect(result.hasNextPage).toBe(true);
    expect(mergeHistoryPages(result.data?.pages ?? [])).toHaveLength(2);
  });

  it('✅ переподключение потока: история перечитывается одной первой страницей, фоновым запросом', async () => {
    const { seen, client, queryClient } = setup(pagedHistory);
    const observer = new InfiniteQueryObserver(queryClient, { ...historyQuery(client, 1), staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    await observer.fetchNextPage();
    await observer.fetchNextPage();
    seen.length = 0;

    await refreshInBackground(queryClient, client, ['history']);
    const result = observer.getCurrentResult();
    unsubscribe();

    expect(seen).toEqual([{ url: '/api/bff/api/v1/cryptocurrencies/1/prices?limit=25', background: true }]);
    expect(result.data?.pages).toHaveLength(1);
    expect(result.hasNextPage).toBe(true);
  });

  it('✅ фоновое перечитывание: только график на экране; другой период и другая монета — помечены устаревшими', async () => {
    const { seen, client, queryClient } = setup((url) =>
      url.pathname.endsWith('/aggregates') ? aggregates([]) : coin(),
    );
    const period = (value: Period) => ({ ...aggregatesQuery(client, 1, '1h', value), staleTime: Infinity });
    const unsubscribe = new QueryObserver(queryClient, period('7d')).subscribe(() => {});
    await queryClient.fetchQuery(period('7d'));
    await queryClient.fetchQuery(period('24h'));
    await queryClient.fetchQuery({ ...coinQuery(client, 2), staleTime: Infinity });
    seen.length = 0;

    await refreshInBackground(queryClient, client, ['coin', 'aggregates']);
    unsubscribe();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ background: true });
    expect(seen[0]?.url).toContain('/cryptocurrencies/1/prices/aggregates?interval=1h');
    expect(queryClient.getQueryState(coinKeys.aggregates(1, '1h', '24h'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(coinKeys.detail(2))?.isInvalidated).toBe(true);
  });
});

describe('[stream-events] событие → кэш карточки монеты', () => {
  function setup() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(coinKeys.detail(1), coin());
    queryClient.setQueryData(coinKeys.aggregates(1, '1h', '7d'), aggregates([bucket('12:00:00', '102', '104')]));
    queryClient.setQueryData(coinKeys.aggregates(1, '4h', '30d'), aggregates([bucket('12:00:00', '102', '104')], '4h'));
    queryClient.setQueryData<PriceHistory>(coinKeys.history(1), { pages: [page(['12:30:00'])], pageParams: [null] });
    const refresh = jest.fn();
    const onPriceChange = jest.fn();
    const send = (data: unknown) =>
      handleStreamEvent({ queryClient, refresh, onPriceChange }, 'price.updated', JSON.stringify(data));
    return { queryClient, refresh, onPriceChange, send };
  }

  it('✅ цена пишется в монету, во все загруженные графики и в историю — без запросов', () => {
    const { queryClient, refresh, onPriceChange, send } = setup();
    send(update());

    expect(queryClient.getQueryData<Cryptocurrency>(coinKeys.detail(1))?.latestPrice?.price).toBe('105');
    for (const key of [coinKeys.aggregates(1, '1h', '7d'), coinKeys.aggregates(1, '4h', '30d')]) {
      expect(queryClient.getQueryData<PriceAggregates>(key)?.buckets[0]?.stats.close).toBe('105');
    }
    expect(queryClient.getQueryData<PriceHistory>(coinKeys.history(1))?.pages[0]?.items).toHaveLength(2);
    // Дашборд не открыт — списка цен в кэше нет, но подсветка цены в карточке работает
    expect(onPriceChange).toHaveBeenCalledWith(1, 'up');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('✅ цена другой монеты карточку не трогает', () => {
    const { queryClient, onPriceChange, send } = setup();
    send(update({ cryptocurrencyId: 2 }));

    expect(queryClient.getQueryData<Cryptocurrency>(coinKeys.detail(1))?.latestPrice?.price).toBe('104');
    expect(queryClient.getQueryData<PriceHistory>(coinKeys.history(1))?.pages[0]?.items).toHaveLength(1);
    expect(onPriceChange).not.toHaveBeenCalled();
  });
});
