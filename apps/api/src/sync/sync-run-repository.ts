// Порт журнала запусков синхронизации (ADR 0015 §2, таблица sync_runs — ADR 0013).
import type { KeysetCursor } from '../common/cursor.ts';

export type SyncTrigger = 'schedule' | 'manual' | 'startup';
export type SyncRunStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted';

export type SyncRunRecord = {
  id: number;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  startedAt: number;
  finishedAt: number | null;
  coinsRequested: number;
  pricesSaved: number;
  attempts: number;
  /** null — CMC не сообщил или запроса не было */
  creditsUsed: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type SyncRunOutcome = {
  status: Exclude<SyncRunStatus, 'running' | 'interrupted'>;
  finishedAt: number;
  coinsRequested: number;
  pricesSaved: number;
  attempts: number;
  creditsUsed: number | null;
  errorCode?: string;
  errorMessage?: string;
};

export interface SyncRunRepository {
  /** null — запуск уже идёт: сработал уникальный индекс sync_runs_one_running (D10) */
  start(trigger: SyncTrigger, startedAt: number): Promise<SyncRunRecord | null>;
  finish(id: number, outcome: SyncRunOutcome): Promise<SyncRunRecord>;
  get(id: number): Promise<SyncRunRecord | null>;
  /** Запуск в статусе running — для 409 с conflictingId */
  running(): Promise<SyncRunRecord | null>;
  /** Самый свежий запуск в любом статусе */
  latest(): Promise<SyncRunRecord | null>;
  /**
   * Последний запуск с одним из статусов среди тех, что реально ходили в CMC (attempts > 0):
   * succeeded/partial — «CMC отвечал», failed — последняя ошибка. Запуск с пустым watchlist CMC не вызывает
   */
  latestAttempted(statuses: readonly SyncRunStatus[]): Promise<SyncRunRecord | null>;
  /** От новых к старым; before — курсор последней строки предыдущей страницы */
  page(limit: number, before: KeysetCursor | null): Promise<SyncRunRecord[]>;
  /** Запуски, оставшиеся running после падения процесса, → interrupted. Возвращает их число */
  markInterrupted(at: number): Promise<number>;
}
