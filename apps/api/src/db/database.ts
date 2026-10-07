// Подключение к SQLite через встроенный node:sqlite (ADR 0003). Одно соединение на процесс:
// SQLite — один файл, пул соединений не нужен.
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

export type DatabaseOptions = {
  /** Сколько ждать снятия блокировки другим процессом, мс (PRAGMA busy_timeout) */
  busyTimeoutMs?: number;
};

export function openDatabase(path: string, options: DatabaseOptions = {}): Database {
  const db = new DatabaseSync(path, {
    timeout: options.busyTimeoutMs ?? 5000,
    enableForeignKeyConstraints: true,
  });
  // WAL: читатели не блокируют писателя. Для ':memory:' SQLite оставляет режим 'memory' — это нормально
  db.exec('PRAGMA journal_mode = WAL');
  // NORMAL в режиме WAL безопасен для целостности: при сбое питания теряется только последняя транзакция
  db.exec('PRAGMA synchronous = NORMAL');
  // Явно, хотя в node:sqlite это значение по умолчанию: без него ON DELETE CASCADE молча не работает
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/**
 * Целое число для параметра SQL. node:sqlite передаёт JS number как REAL: `fetched_at / ?` с параметром 3600000
 * даёт дробь, и бакеты перестают группироваться (ADR 0007). BigInt уходит как INTEGER.
 */
export function sqlInt(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Ожидалось безопасное целое для SQL-параметра, получено ${value}`);
  }
  return BigInt(value);
}
