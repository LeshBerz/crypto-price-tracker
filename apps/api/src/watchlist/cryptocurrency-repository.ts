// Порт хранилища монет watchlist (ADR 0015 §2, схема — ADR 0013).

export type CryptocurrencyRecord = {
  id: number;
  cmcId: number;
  symbol: string;
  name: string;
  isPaused: boolean;
  /** Когда сохранена последняя цена (D-1); null до первой синхронизации */
  lastUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type NewCryptocurrency = Pick<CryptocurrencyRecord, 'cmcId' | 'symbol' | 'name' | 'createdAt'>;
export type CryptocurrencyPatch = { name?: string; isPaused?: boolean };

export interface CryptocurrencyRepository {
  list(): Promise<CryptocurrencyRecord[]>;
  /** Монеты, которые синхронизируются: без поставленных на паузу */
  listActive(): Promise<CryptocurrencyRecord[]>;
  get(id: number): Promise<CryptocurrencyRecord | null>;
  /** Монета с этим символом или этим cmc_id — для 409 already-tracked */
  findConflict(symbol: string, cmcId: number | undefined): Promise<CryptocurrencyRecord | null>;
  count(): Promise<number>;
  create(coin: NewCryptocurrency): Promise<CryptocurrencyRecord>;
  /** null — монеты нет */
  update(id: number, patch: CryptocurrencyPatch, at: number): Promise<CryptocurrencyRecord | null>;
  /** false — монеты нет. История и свёртки удаляются каскадом (ADR 0013 №4) */
  delete(id: number): Promise<boolean>;
  /** Проставляет last_updated_at монетам, у которых сохранена новая цена (D-1) */
  markUpdated(ids: readonly number[], at: number): Promise<void>;
  /** Когда в последний раз сохранялась цена хоть одной монеты; null — ни разу */
  lastUpdatedAt(): Promise<number | null>;
}
