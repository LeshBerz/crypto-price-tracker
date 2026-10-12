import { detectDegradation, type DegradationInput } from '@/lib/dashboard/degradation';
import type { LatestPriceList } from '@/lib/dashboard/queries';

const FETCHED = '2026-10-12T12:00:00.000Z';
const OLDER = '2026-10-12T11:40:00.000Z';

type Coin = { id: number; stale?: boolean; fetchedAt?: string; empty?: boolean };

function prices(status: NonNullable<LatestPriceList['lastSync']>['status'] | null, coins: Coin[]): LatestPriceList {
  return {
    currency: 'USD',
    lastSync: status ? { id: 1, status, finishedAt: FETCHED } : null,
    items: coins.map(({ id, stale = false, fetchedAt = FETCHED, empty = false }) => ({
      cryptocurrencyId: id,
      symbol: `C${id}`,
      name: `Coin ${id}`,
      latest: empty
        ? null
        : {
            price: '1',
            currency: 'USD',
            sourceUpdatedAt: fetchedAt,
            fetchedAt,
            change24hPercent: null,
            isStale: stale,
          },
    })),
  };
}

const input = (overrides: Partial<DegradationInput>): DegradationInput => ({
  prices: prices('succeeded', [{ id: 1 }, { id: 2 }]),
  pausedIds: new Set(),
  refreshError: null,
  pricesUpdatedAt: 1000,
  streamStatus: 'open',
  ...overrides,
});

describe('[degradation] баннер дашборда', () => {
  it('✅ всё в порядке — баннера нет', () => {
    expect(detectDegradation(input({}))).toBeNull();
  });

  it('✅ данных ещё нет — баннера нет: это состояние загрузки или карточки ошибки', () => {
    expect(detectDegradation(input({ prices: undefined, refreshError: { requestId: 'r' } }))).toBeNull();
  });

  it('✅ перезапрос не удался: api недоступен, показаны данные прошлого ответа', () => {
    expect(detectDegradation(input({ refreshError: { requestId: 'r-502' } }))).toEqual({
      kind: 'api-unavailable',
      shownAt: 1000,
      requestId: 'r-502',
    });
  });

  it('✅ цены устарели после неудачной синхронизации: источник недоступен', () => {
    const list = prices('failed', [
      { id: 1, stale: true, fetchedAt: OLDER },
      { id: 2, stale: true },
    ]);

    expect(detectDegradation(input({ prices: list }))).toEqual({
      kind: 'stale',
      staleCount: 2,
      all: true,
      sourceFailed: true,
      lastFetchedAt: FETCHED,
    });
  });

  it('✅ цены устарели, а последний запуск успешен (планировщик остановлен): источник не обвиняется', () => {
    const list = prices('succeeded', [{ id: 1, stale: true }]);

    expect(detectDegradation(input({ prices: list }))).toMatchObject({ kind: 'stale', sourceFailed: false });
  });

  it('✅ устарела часть монет при успешном запуске: время последнего обновления к ним не относится', () => {
    const list = prices('succeeded', [{ id: 1, stale: true, fetchedAt: OLDER }, { id: 2 }]);

    expect(detectDegradation(input({ prices: list }))).toMatchObject({ kind: 'stale', staleCount: 1, all: false });
  });

  it('✅ частичная синхронизация с устаревшими ценами', () => {
    const list = prices('partial', [{ id: 1, stale: true }, { id: 2 }, { id: 3 }]);

    expect(detectDegradation(input({ prices: list }))).toEqual({ kind: 'partial', staleCount: 1 });
  });

  it.each(['failed', 'partial'] as const)('✅ запуск %s, но цены ещё свежие — мягкое сообщение', (status) => {
    expect(detectDegradation(input({ prices: prices(status, [{ id: 1 }]) }))).toEqual({
      kind: 'sync-failed',
      status,
      finishedAt: FETCHED,
      lastFetchedAt: FETCHED,
    });
  });

  it('✅ монета на паузе устарела — это не деградация (ADR 0017)', () => {
    const list = prices('succeeded', [{ id: 1, stale: true }, { id: 2 }]);

    expect(detectDegradation(input({ prices: list, pausedIds: new Set([1]) }))).toBeNull();
  });

  it('✅ список монет ещё не загружен — устаревшие цены не объявляются сбоем раньше времени', () => {
    const list = prices('failed', [{ id: 1, stale: true }]);

    expect(detectDegradation(input({ prices: list, pausedIds: null }))).toBeNull();
  });

  it('✅ монета без цены (ждёт первой синхронизации) не считается устаревшей', () => {
    const list = prices('succeeded', [{ id: 1, empty: true }, { id: 2 }]);

    expect(detectDegradation(input({ prices: list }))).toBeNull();
  });

  it('✅ запуск interrupted или running — не деградация', () => {
    expect(detectDegradation(input({ prices: prices('interrupted', [{ id: 1 }]) }))).toBeNull();
    expect(detectDegradation(input({ prices: prices('running', [{ id: 1 }]) }))).toBeNull();
  });

  it('✅ поток переподключается — сообщение о realtime; первое подключение — нет', () => {
    expect(detectDegradation(input({ streamStatus: 'reconnecting' }))).toEqual({ kind: 'stream-offline' });
    expect(detectDegradation(input({ streamStatus: 'connecting' }))).toBeNull();
  });

  it('✅ причин несколько — показывается самая серьёзная', () => {
    const list = prices('failed', [{ id: 1, stale: true }]);

    expect(
      detectDegradation(input({ prices: list, refreshError: { requestId: null }, streamStatus: 'reconnecting' }))?.kind,
    ).toBe('api-unavailable');
    expect(detectDegradation(input({ prices: list, streamStatus: 'reconnecting' }))?.kind).toBe('stale');
  });
});
