// Порт хранилища API-ключей (ADR 0015 §2). Ядро знает только этот интерфейс; адаптер SQLite — db/repositories/api-keys.ts,
// адаптер Postgres появится в platform. Методы асинхронные, хотя node:sqlite синхронный: иначе Postgres не встанет на место.

export type ApiKeyRecord = {
  id: number;
  name: string;
  /** Первые 12 символов ключа — для поиска и чтобы человек узнал ключ в списке */
  keyPrefix: string;
  /** SHA-256 hex. Сам ключ не хранится нигде */
  keyHash: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type NewApiKey = Pick<ApiKeyRecord, 'name' | 'keyPrefix' | 'keyHash' | 'scopes' | 'createdAt'>;

export interface ApiKeyRepository {
  findByPrefix(prefix: string): Promise<ApiKeyRecord | null>;
  findByName(name: string): Promise<ApiKeyRecord | null>;
  create(key: NewApiKey): Promise<ApiKeyRecord>;
  /** Новый секрет под тем же именем (bootstrap-ключ в env сменили): старый ключ перестаёт работать сразу */
  replaceSecret(id: number, key: Omit<NewApiKey, 'name'>): Promise<void>;
  setScopes(id: number, scopes: string[]): Promise<void>;
  touch(id: number, at: number): Promise<void>;
  /** false — ключа с таким именем нет или он уже отозван */
  revoke(name: string, at: number): Promise<boolean>;
}
