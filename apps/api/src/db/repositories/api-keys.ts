// Адаптер ApiKeyRepository на node:sqlite: raw SQL (C1), подготовленные запросы, целые параметры — BigInt (ADR 0007).
import type { ApiKeyRecord, ApiKeyRepository, NewApiKey } from '../../auth/api-key-repository.ts';
import { sqlInt, type Database } from '../database.ts';
import { assertInTransaction } from '../transaction.ts';

type ApiKeyRow = {
  id: number;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

const COLUMNS = 'id, name, key_prefix, key_hash, scopes, created_at, last_used_at, revoked_at';

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    // CHECK в схеме гарантирует JSON-массив
    scopes: JSON.parse(row.scopes) as string[],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export class SqliteApiKeyRepository implements ApiKeyRepository {
  private readonly db: Database;
  private readonly statements;

  constructor(db: Database) {
    this.db = db;
    this.statements = {
      byPrefix: db.prepare(`SELECT ${COLUMNS} FROM api_keys WHERE key_prefix = ?`),
      byName: db.prepare(`SELECT ${COLUMNS} FROM api_keys WHERE name = ?`),
      insert: db.prepare(
        `INSERT INTO api_keys (name, key_prefix, key_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
      ),
      replaceSecret: db.prepare(
        `UPDATE api_keys SET key_prefix = ?, key_hash = ?, scopes = ?, created_at = ?, last_used_at = NULL, revoked_at = NULL
         WHERE id = ?`,
      ),
      setScopes: db.prepare('UPDATE api_keys SET scopes = ? WHERE id = ?'),
      touch: db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?'),
      revoke: db.prepare('UPDATE api_keys SET revoked_at = ? WHERE name = ? AND revoked_at IS NULL'),
    };
  }

  async findByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
    assertInTransaction(this.db);
    const row = this.statements.byPrefix.get(prefix) as ApiKeyRow | undefined;
    return row ? toRecord(row) : null;
  }

  async findByName(name: string): Promise<ApiKeyRecord | null> {
    assertInTransaction(this.db);
    const row = this.statements.byName.get(name) as ApiKeyRow | undefined;
    return row ? toRecord(row) : null;
  }

  async create(key: NewApiKey): Promise<ApiKeyRecord> {
    assertInTransaction(this.db);
    const row = this.statements.insert.get(
      key.name,
      key.keyPrefix,
      key.keyHash,
      JSON.stringify(key.scopes),
      sqlInt(key.createdAt),
    ) as ApiKeyRow;
    return toRecord(row);
  }

  async replaceSecret(id: number, key: Omit<NewApiKey, 'name'>): Promise<void> {
    assertInTransaction(this.db);
    this.statements.replaceSecret.run(
      key.keyPrefix,
      key.keyHash,
      JSON.stringify(key.scopes),
      sqlInt(key.createdAt),
      sqlInt(id),
    );
  }

  async setScopes(id: number, scopes: string[]): Promise<void> {
    assertInTransaction(this.db);
    this.statements.setScopes.run(JSON.stringify(scopes), sqlInt(id));
  }

  async touch(id: number, at: number): Promise<void> {
    assertInTransaction(this.db);
    this.statements.touch.run(sqlInt(at), sqlInt(id));
  }

  async revoke(name: string, at: number): Promise<boolean> {
    assertInTransaction(this.db);
    return this.statements.revoke.run(sqlInt(at), name).changes > 0;
  }
}
