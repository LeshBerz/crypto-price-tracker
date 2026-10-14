// Порт Logger и его адаптер: JSON-строка на событие в stdout (ADR 0015).
// Структурированные логи можно фильтровать по полям (requestId, syncRunId), а не грепать текст.
import type { Clock } from './clock.ts';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Логгер с полями, которые попадут в каждую запись (requestId, syncRunId) */
  child(fields: LogFields): Logger;
}

export type JsonLoggerOptions = {
  level: LogLevel;
  clock: Clock;
  /** Куда писать готовую строку. По умолчанию — stdout */
  write?: (line: string) => void;
};

export const REDACTED = '[REDACTED]';
// Секреты по имени поля: заголовок Authorization, ключ CMC (apiKey), пароли, токены, cookie
const SECRET_KEY = /authorization|cookie|password|secret|token|api[-_]?key/i;
// Секреты по значению: наш API-ключ узнаётся по префиксу (ADR 0002), даже если поле названо невинно
const API_KEY_VALUE = /cpt_[A-Za-z0-9_-]{4,}/g;
const RESERVED = new Set(['time', 'level', 'msg']);
const MAX_DEPTH = 6;

export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(line + '\n'));
  const threshold = LOG_LEVELS.indexOf(options.level);

  const make = (bound: LogFields): Logger => {
    const log = (level: LogLevel, msg: string, fields?: LogFields) => {
      if (LOG_LEVELS.indexOf(level) < threshold) return;
      const entry: LogFields = { time: new Date(options.clock.now()).toISOString(), level, msg };
      for (const [key, value] of Object.entries({ ...bound, ...fields })) {
        // Поле не может подменить служебные time/level/msg — сохраняем его под другим именем
        entry[RESERVED.has(key) ? `_${key}` : key] = value;
      }
      write(JSON.stringify(redact(entry, 0, new WeakSet())));
    };
    return {
      debug: (msg, fields) => log('debug', msg, fields),
      info: (msg, fields) => log('info', msg, fields),
      warn: (msg, fields) => log('warn', msg, fields),
      error: (msg, fields) => log('error', msg, fields),
      child: (fields) => make({ ...bound, ...fields }),
    };
  };

  return make({});
}

/** Готовит значение к JSON: маскирует секреты, раскрывает Error, BigInt → строка, циклы и глубина — без падения */
function redact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return value.replace(API_KEY_VALUE, `cpt_${REDACTED}`);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  // seen — только предки текущего узла: один объект в двух соседних полях — не цикл
  seen.add(value);
  try {
    if (value instanceof Error) {
      const error: LogFields = { name: value.name, message: value.message, stack: value.stack };
      if (value.cause !== undefined) error.cause = value.cause;
      return redact(error, depth + 1, seen);
    }
    if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

    const result: LogFields = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/** Логгер-заглушка: для CLI-утилит и тестов, где логи не нужны */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
