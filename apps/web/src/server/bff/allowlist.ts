// Allowlist BFF (ADR 0016): «метод + путь api → минимальная роль». Чего нет в таблице — в api не уходит (404).
// Тест tests/bff-allowlist.test.ts сверяет таблицу с openapi.yaml: новая операция без строки здесь — красный CI.
import type { paths } from '@/generated/api-types';
import type { Role } from '../users';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Пары «метод + путь», которые есть в контракте. Опечатка в пути или метод, которого у пути нет, — ошибка
 * компиляции: openapi-typescript описывает отсутствующий метод как `never`.
 */
type ContractRoute = {
  [P in keyof paths]: {
    [M in HttpMethod]: [NonNullable<paths[P][M]>] extends [never] ? never : { method: Uppercase<M>; path: P };
  }[HttpMethod];
}[keyof paths];

export type AllowedRoute = ContractRoute & { role: Role };

/** Поток событий идёт не через общий прокси, а через свой маршрут /api/stream — с перепроверкой сессии */
export const STREAM_PATH = '/api/v1/stream' satisfies keyof paths;

export const ALLOWLIST: readonly AllowedRoute[] = [
  { method: 'GET', path: '/health/live', role: 'viewer' },
  { method: 'GET', path: '/health/ready', role: 'viewer' },

  { method: 'GET', path: '/api/v1/cryptocurrencies', role: 'viewer' },
  { method: 'POST', path: '/api/v1/cryptocurrencies', role: 'operator' },
  { method: 'GET', path: '/api/v1/cryptocurrencies/{id}', role: 'viewer' },
  { method: 'PATCH', path: '/api/v1/cryptocurrencies/{id}', role: 'operator' },
  { method: 'DELETE', path: '/api/v1/cryptocurrencies/{id}', role: 'operator' },

  { method: 'GET', path: '/api/v1/prices', role: 'viewer' },
  { method: 'GET', path: '/api/v1/prices/sparklines', role: 'viewer' },
  { method: 'GET', path: '/api/v1/cryptocurrencies/{id}/prices', role: 'viewer' },
  { method: 'GET', path: '/api/v1/cryptocurrencies/{id}/prices/aggregates', role: 'viewer' },

  { method: 'GET', path: '/api/v1/sync-runs', role: 'operator' },
  { method: 'POST', path: '/api/v1/sync-runs', role: 'operator' },
  { method: 'GET', path: '/api/v1/sync-runs/{id}', role: 'operator' },
  { method: 'GET', path: '/api/v1/system/cmc', role: 'operator' },
];

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1 };

export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Значение параметра пути: id в контракте — целое число, запас — буквы, дефис и подчёркивание */
const PARAM_VALUE = /^[A-Za-z0-9_-]{1,64}$/;

const COMPILED = ALLOWLIST.map((route) => ({ route, segments: route.path.split('/') }));

/**
 * Ищет строку таблицы для запроса. Сравнение — по сегментам пути: `{id}` совпадает с одним сегментом, литерал —
 * только с самим собой, поэтому `/prices/sparklines` не принимается за `/prices/{id}`, а лишние сегменты — за часть id.
 */
export function matchRoute(method: string, pathname: string): AllowedRoute | null {
  const segments = pathname.split('/');
  for (const candidate of COMPILED) {
    if (candidate.route.method !== method || candidate.segments.length !== segments.length) continue;
    const matches = candidate.segments.every((expected, index) => {
      const actual = segments[index] ?? '';
      return expected.startsWith('{') ? PARAM_VALUE.test(actual) : expected === actual;
    });
    if (matches) return candidate.route;
  }
  return null;
}
