// Расчёты экрана «Система» и карточки «Сейчас»: доступность CoinMarketCap, квота, расписание и прогноз.
// Чистые функции: время передаётся параметром, сеть и React не участвуют.
import type { CmcStatus, SyncRun } from './queries';

export type CmcQuota = NonNullable<CmcStatus['quota']>;

/** unknown — к CoinMarketCap ещё не обращались: ни успеха, ни ошибки в журнале нет */
export type CmcAvailability = 'available' | 'unavailable' | 'unknown';

/** Источник недоступен, если последнее обращение к нему закончилось ошибкой: ошибка новее последнего успеха */
export function cmcAvailability(status: Pick<CmcStatus, 'lastSuccessAt' | 'lastError'>): CmcAvailability {
  const { lastSuccessAt, lastError } = status;
  if (!lastSuccessAt && !lastError) return 'unknown';
  if (!lastError) return 'available';
  if (!lastSuccessAt) return 'unavailable';
  return Date.parse(lastError.at) > Date.parse(lastSuccessAt) ? 'unavailable' : 'available';
}

/** Доля использованной квоты месяца в процентах, 0–100. Лимит 0 (ключ без квоты) — 100 */
export function quotaPercent(quota: Pick<CmcQuota, 'creditsUsedMonth' | 'creditLimitMonthly'>): number {
  if (quota.creditLimitMonthly <= 0) return 100;
  return Math.min(100, Math.round((quota.creditsUsedMonth / quota.creditLimitMonthly) * 100));
}

export type Schedule = {
  state: 'running' | 'stopped' | 'disabled';
  intervalMs: number;
  nextRunAt: string | null;
};

const STATES = new Set(['running', 'stopped', 'disabled']);

/**
 * Расписание синхронизации из ответа `getCmcStatus` (ADR 0017, вариант 1D). Блок `schedule` появляется в
 * контракте 1.1.0; api версии 1.0.0 его не отдаёт — тогда `null`, и интерфейс не показывает ни «следующий
 * запуск», ни прогноз квоты. Оценивать их на клиенте нельзя: интервал и момент запуска знает только api.
 */
export function readSchedule(status: unknown): Schedule | null {
  if (typeof status !== 'object' || status === null) return null;
  const schedule = (status as { schedule?: unknown }).schedule;
  if (typeof schedule !== 'object' || schedule === null) return null;
  const { state, intervalMs, nextRunAt } = schedule as Record<string, unknown>;
  if (!STATES.has(state as string)) return null;
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  if (nextRunAt !== null && (typeof nextRunAt !== 'string' || Number.isNaN(Date.parse(nextRunAt)))) return null;
  return { state: state as Schedule['state'], intervalMs, nextRunAt };
}

/** Сколько последних запусков берётся в среднее: расход зависит от размера watchlist, а он меняется */
export const CREDITS_SAMPLE = 20;

/**
 * Средний расход кредитов CoinMarketCap на запуск — по последним запускам, где расход известен.
 * Запуски без обращения к источнику (пустой watchlist, сбой до запроса) в среднее не входят.
 */
export function averageCreditsPerRun(runs: readonly SyncRun[]): number | null {
  const used = runs
    .map((run) => run.creditsUsed)
    .filter((credits): credits is number => credits !== null && credits > 0)
    .slice(0, CREDITS_SAMPLE);
  if (used.length === 0) return null;
  return used.reduce((sum, credits) => sum + credits, 0) / used.length;
}

/** Начало следующего месяца по UTC: в этот момент CoinMarketCap обнуляет месячный счётчик кредитов */
export function nextMonthStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export type QuotaForecast = {
  /** Сколько кредитов уйдёт до конца месяца при текущем интервале */
  needed: number;
  enough: boolean;
  /** Когда кончатся кредиты, epoch ms; `null`, если их хватит */
  runsOutAt: number | null;
};

/**
 * Хватит ли квоты до конца месяца. Оценка сверху: запуски считаются каждые `intervalMs`, хотя планировщик
 * отсчитывает интервал от завершения запуска и на деле запусков чуть меньше. Ошибка в безопасную сторону:
 * прогноз скорее предупредит зря, чем промолчит.
 */
export function forecastQuota(input: {
  creditsLeftMonth: number;
  intervalMs: number;
  creditsPerRun: number;
  now: number;
}): QuotaForecast {
  const { creditsLeftMonth, intervalMs, creditsPerRun, now } = input;
  const runsLeft = Math.max(0, nextMonthStart(now) - now) / intervalMs;
  const needed = Math.ceil(runsLeft * creditsPerRun);
  const enough = needed <= creditsLeftMonth;
  return {
    needed,
    enough,
    runsOutAt: enough ? null : now + Math.floor((creditsLeftMonth / creditsPerRun) * intervalMs),
  };
}

/** Длительность запуска в мс; `null`, пока он идёт */
export function runDurationMs(run: Pick<SyncRun, 'startedAt' | 'finishedAt'>): number | null {
  return run.finishedAt === null ? null : Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
}
