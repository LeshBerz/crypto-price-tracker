// SyncService (ADR 0015 §4): один запуск синхронизации цен (F6, D10) и чтение журнала запусков.
// Порядок запуска: запись running → котировки CMC вне транзакции, с ретраями → цены, свёртки и итог одной
// транзакцией → события после COMMIT. Знает только порты; аналог в Nest — @Injectable() сервис, который
// дёргают и @Cron-задача, и контроллер.
import type { Clock } from '../common/clock.ts';
import { decodeCursor, encodeCursor } from '../common/cursor.ts';
import type { Logger } from '../common/logger.ts';
import { createEvent, type EventBus } from '../events/event-bus.ts';
import type { components } from '../generated/api-types.ts';
import {
  MarketDataError,
  MAX_IDS_PER_REQUEST,
  type CmcUsage,
  type MarketDataProvider,
  type QuotesResult,
} from '../market-data/provider.ts';
import { withRetry } from '../market-data/retry.ts';
import type { NewPricePoint } from '../prices/price-repository.ts';
import type { UnitOfWork } from '../unit-of-work.ts';
import type { CryptocurrencyRecord } from '../watchlist/cryptocurrency-repository.ts';
import type { SyncRunOutcome, SyncRunRecord, SyncTrigger } from './sync-run-repository.ts';

export type SyncRun = components['schemas']['SyncRun'];

const HOUR_MS = 3_600_000;
/** error_code запуска, который сохранил не все запрошенные монеты */
export const PARTIAL_CODE = 'SYNC_PARTIAL';
/** error_code сбоя не на стороне CMC (например, БД): подробности — только в логе */
export const INTERNAL_CODE = 'SYNC_INTERNAL';

export class SyncAlreadyRunningError extends Error {
  override name = 'SyncAlreadyRunningError';
  /** id идущего запуска; undefined — он завершился, пока мы его искали */
  readonly conflictingId: number | undefined;

  constructor(conflictingId: number | undefined) {
    super('Sync is already running');
    this.conflictingId = conflictingId;
  }
}

export class SyncQueryError extends Error {
  override name = 'SyncQueryError';
  readonly kind: 'not-found' | 'invalid-cursor';

  constructor(kind: 'not-found' | 'invalid-cursor', message: string) {
    super(message);
    this.kind = kind;
  }
}

export type CmcQuota = CmcUsage & { fetchedAt: number };
export type CmcStatus = {
  lastSuccess: SyncRunRecord | null;
  lastFailure: SyncRunRecord | null;
  quota: CmcQuota | null;
};
export type SyncRunPage = { items: SyncRunRecord[]; nextCursor: string | null };
export type StartedSync = { run: SyncRunRecord; finished: Promise<SyncRunRecord> };

export type SyncDeps = {
  uow: UnitOfWork;
  marketData: MarketDataProvider;
  events: EventBus;
  clock: Clock;
  logger: Logger;
};

export function toSyncRun(run: SyncRunRecord): SyncRun {
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: run.finishedAt === null ? null : new Date(run.finishedAt).toISOString(),
    coinsRequested: run.coinsRequested,
    pricesSaved: run.pricesSaved,
    attempts: run.attempts,
    creditsUsed: run.creditsUsed,
    error: run.errorCode === null ? null : { code: run.errorCode, message: run.errorMessage ?? '' },
  };
}

export class SyncService {
  private readonly deps: SyncDeps;
  /** Первый слой защиты от наложения: запуск этого процесса, от записи running до итога */
  private active: { started: Promise<SyncRunRecord | null>; controller: AbortController } | null = null;
  private finished: Promise<unknown> = Promise.resolve();
  private cachedQuota: CmcQuota | null = null;

  constructor(deps: SyncDeps) {
    this.deps = deps;
  }

  /**
   * Начинает запуск и возвращает его запись сразу (running), не дожидаясь CMC: так ручной запуск отвечает 202.
   * finished никогда не отклоняется — любой сбой становится статусом запуска.
   * От наложения защищают два слоя: поле active (дёшево, без похода в БД) и частичный уникальный индекс
   * sync_runs — он работает и между процессами (ADR 0015 §4).
   */
  async start(trigger: SyncTrigger): Promise<StartedSync> {
    const { uow, clock } = this.deps;
    if (this.active) {
      const running = await this.active.started.catch(() => null);
      throw new SyncAlreadyRunningError(running?.id);
    }
    const controller = new AbortController();
    const started = uow.run((repos) => repos.syncRuns.start(trigger, clock.now()));
    const active = { started, controller };
    this.active = active;
    const release = () => {
      if (this.active === active) this.active = null;
    };

    let run: SyncRunRecord | null;
    try {
      run = await started;
    } catch (error) {
      release();
      throw error;
    }
    if (run === null) {
      release();
      const other = await uow.run((repos) => repos.syncRuns.running());
      throw new SyncAlreadyRunningError(other?.id);
    }

    const finished = this.execute(run, controller.signal).finally(release);
    this.finished = finished;
    return { run, finished };
  }

  /** Запуск целиком: для планировщика, которому нужен итог, а не 202 */
  async run(trigger: SyncTrigger): Promise<SyncRunRecord> {
    return (await this.start(trigger)).finished;
  }

  /** Прерывает идущий запуск (остановка процесса): запрос к CMC и ожидание ретрая отменяются */
  abort(reason: Error): void {
    this.active?.controller.abort(reason);
  }

  /** Ждёт завершения идущего запуска; если его нет — возвращается сразу */
  async idle(): Promise<void> {
    await this.finished;
  }

  async get(id: number): Promise<SyncRunRecord> {
    const run = await this.deps.uow.run((repos) => repos.syncRuns.get(id));
    if (!run) throw new SyncQueryError('not-found', `Sync run ${id} does not exist`);
    return run;
  }

  async page(limit: number, cursor?: string): Promise<SyncRunPage> {
    const before = cursor === undefined ? null : decodeCursor(cursor);
    if (cursor !== undefined && before === null) {
      throw new SyncQueryError('invalid-cursor', 'Cursor is not valid: use nextCursor from the previous page as is');
    }
    const rows = await this.deps.uow.run((repos) => repos.syncRuns.page(limit + 1, before));
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor({ at: last.startedAt, id: last.id }) : null,
    };
  }

  /** Состояние интеграции с CMC: исходы — из журнала запусков, квота — из кэша последнего key/info */
  cmcStatus(): Promise<CmcStatus> {
    return this.deps.uow.run(async (repos) => ({
      lastSuccess: await repos.syncRuns.latestAttempted(['succeeded', 'partial']),
      lastFailure: await repos.syncRuns.latestAttempted(['failed']),
      quota: this.cachedQuota,
    }));
  }

  private async execute(run: SyncRunRecord, signal: AbortSignal): Promise<SyncRunRecord> {
    const { uow, clock, logger } = this.deps;
    const log = (record: SyncRunRecord) => {
      const level = record.status === 'failed' ? 'error' : record.status === 'succeeded' ? 'info' : 'warn';
      logger[level]('sync finished', {
        syncRunId: record.id,
        trigger: record.trigger,
        status: record.status,
        durationMs: (record.finishedAt ?? record.startedAt) - record.startedAt,
        pricesSaved: record.pricesSaved,
        attempts: record.attempts,
        errorCode: record.errorCode,
      });
      return record;
    };

    let attempts = 0;
    let coins: CryptocurrencyRecord[] = [];
    try {
      coins = await uow.run((repos) => repos.cryptocurrencies.listActive());
      // Пустой watchlist: CMC не вызываем, квоту не тратим
      if (coins.length === 0) return log(await this.finish(run, { status: 'succeeded' }, [], coins));

      const result = await withRetry(
        (attempt) => {
          attempts = attempt;
          return this.fetchQuotes(coins, signal);
        },
        {
          clock,
          signal,
          onRetry: ({ attempt, error, delayMs }) =>
            logger.warn('sync retry', { syncRunId: run.id, attempt, code: error.code, delayMs }),
        },
      );
      const record = log(await this.save(run, coins, result, attempts));
      await this.refreshQuota(signal);
      return record;
    } catch (error) {
      const known = error instanceof MarketDataError;
      if (!known && !signal.aborted) logger.error('sync crashed', { syncRunId: run.id, error });
      try {
        if (signal.aborted) {
          // Остановка процесса: итог запуска неизвестен, честный статус — interrupted
          const record = await uow.run(async (repos) => {
            await repos.syncRuns.markInterrupted(clock.now());
            return (await repos.syncRuns.get(run.id)) as SyncRunRecord;
          });
          return log(this.announce(record, []));
        }
        // Старые цены остаются в БД и продолжают отдаваться (graceful degradation, F7)
        return log(
          await this.finish(
            run,
            {
              status: 'failed',
              coinsRequested: coins.length,
              attempts,
              errorCode: known ? error.code : INTERNAL_CODE,
              errorMessage: known ? error.message : 'Unexpected error. See logs by syncRunId',
            },
            [],
            coins,
          ),
        );
      } catch (finishError) {
        // БД недоступна: запись останется running и станет interrupted при следующем старте процесса
        logger.error('sync result was not saved', { syncRunId: run.id, error: finishError });
        return run;
      }
    }
  }

  /** CMC отдаёт не больше 100 id за вызов; watchlist ограничен теми же 100, но код от этого лимита не зависит */
  private async fetchQuotes(coins: readonly CryptocurrencyRecord[], signal: AbortSignal): Promise<QuotesResult> {
    const total: QuotesResult = { quotes: [], missing: [], rejected: [], creditsUsed: null };
    for (let offset = 0; offset < coins.length; offset += MAX_IDS_PER_REQUEST) {
      const ids = coins.slice(offset, offset + MAX_IDS_PER_REQUEST).map((coin) => coin.cmcId);
      const part = await this.deps.marketData.getQuotes(ids, signal);
      total.quotes.push(...part.quotes);
      total.missing.push(...part.missing);
      total.rejected.push(...part.rejected);
      if (part.creditsUsed !== null) total.creditsUsed = (total.creditsUsed ?? 0) + part.creditsUsed;
    }
    return total;
  }

  /** Цены, свёртки текущего часа, last_updated_at и итог запуска — одной транзакцией: либо всё, либо ничего */
  private async save(
    run: SyncRunRecord,
    coins: readonly CryptocurrencyRecord[],
    result: QuotesResult,
    attempts: number,
  ): Promise<SyncRunRecord> {
    const fetchedAt = this.deps.clock.now();
    const byCmcId = new Map(coins.map((coin) => [coin.cmcId, coin]));
    const points = result.quotes.flatMap((quote): NewPricePoint[] => {
      const coin = byCmcId.get(quote.cmcId);
      if (!coin) return [];
      return [
        {
          cryptocurrencyId: coin.id,
          syncRunId: run.id,
          price: quote.price,
          sourceUpdatedAt: quote.sourceUpdatedAt,
          fetchedAt,
        },
      ];
    });
    const problems = [
      result.missing.length > 0 && `no quote for cmcId: ${result.missing.join(', ')}`,
      result.rejected.length > 0 &&
        `invalid quote for cmcId: ${result.rejected.map((item) => `${item.cmcId} (${item.reason})`).join(', ')}`,
    ].filter((text) => text !== false);
    const outcome: Partial<SyncRunOutcome> & Pick<SyncRunOutcome, 'status'> =
      problems.length === 0
        ? { status: 'succeeded' }
        : { status: 'partial', errorCode: PARTIAL_CODE, errorMessage: problems.join('; ') };

    return this.finish(
      run,
      { ...outcome, coinsRequested: coins.length, attempts, creditsUsed: result.creditsUsed },
      points,
      coins,
    );
  }

  private async finish(
    run: SyncRunRecord,
    outcome: Partial<SyncRunOutcome> & Pick<SyncRunOutcome, 'status'>,
    points: readonly NewPricePoint[],
    coins: readonly CryptocurrencyRecord[],
  ): Promise<SyncRunRecord> {
    const { uow, clock } = this.deps;
    const finishedAt = clock.now();
    const { record, saved } = await uow.run(async (repos) => {
      const saved = await repos.prices.insertMany(points);
      const ids = saved.map((point) => point.cryptocurrencyId);
      for (const point of saved) {
        await repos.prices.recomputeRollup(point.cryptocurrencyId, point.fetchedAt - (point.fetchedAt % HOUR_MS));
      }
      if (ids.length > 0) await repos.cryptocurrencies.markUpdated(ids, finishedAt);
      const record = await repos.syncRuns.finish(run.id, {
        coinsRequested: 0,
        attempts: 0,
        creditsUsed: null,
        ...outcome,
        finishedAt,
        pricesSaved: saved.length,
      });
      return { record, saved };
    });
    const symbols = new Map(coins.map((coin) => [coin.id, coin.symbol]));
    return this.announce(
      record,
      saved.map((point) => ({ point, symbol: symbols.get(point.cryptocurrencyId) as string })),
    );
  }

  /** События — только после COMMIT: при откате подписчик SSE увидел бы цену, которой нет в БД */
  private announce(record: SyncRunRecord, saved: readonly { point: NewPricePoint; symbol: string }[]): SyncRunRecord {
    const { events, clock } = this.deps;
    for (const { point, symbol } of saved) {
      events.publish(
        createEvent(
          'price.updated',
          {
            cryptocurrencyId: point.cryptocurrencyId,
            symbol,
            price: point.price,
            currency: 'USD',
            sourceUpdatedAt: new Date(point.sourceUpdatedAt).toISOString(),
            fetchedAt: new Date(point.fetchedAt).toISOString(),
            syncRunId: record.id,
          },
          clock,
        ),
      );
    }
    events.publish(createEvent('sync.finished', toSyncRun(record), clock));
    return record;
  }

  /** key/info кредитов не тратит. Сбой здесь на итог запуска не влияет: квота — справочная */
  private async refreshQuota(signal: AbortSignal): Promise<void> {
    try {
      this.cachedQuota = { ...(await this.deps.marketData.getUsage(signal)), fetchedAt: this.deps.clock.now() };
    } catch (error) {
      this.deps.logger.warn('cmc usage refresh failed', { error });
    }
  }
}
