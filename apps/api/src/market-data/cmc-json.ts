// Разбор JSON от CMC без потери точности цен (ADR 0006). CMC отдаёт цену JSON-числом, а обычный JSON.parse
// превращает его в double ещё до нашего кода: 67123.451234567891 → 67123.4512345679.

/** Третий аргумент reviver (ES2025, «JSON.parse source text access»): исходный текст примитива */
type ReviverContext = { source?: string };

/** Ключи, числа под которыми забираем исходным текстом, а не double */
const EXACT_NUMBER_KEYS = new Set(['price']);

export function parseCmcJson(text: string): unknown {
  // context объявлен необязательным только ради типа JSON.parse; в Node 24 (engines) он есть всегда
  return JSON.parse(text, (key: string, value: unknown, context?: ReviverContext) =>
    EXACT_NUMBER_KEYS.has(key) && typeof value === 'number' ? (context as ReviverContext).source : value,
  );
}

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
