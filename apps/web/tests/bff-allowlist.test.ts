// Сверка allowlist BFF с контрактом api (ADR 0016). Читается сам файл спеки, код api не импортируется (ADR 0005).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { ALLOWLIST, hasRole, matchRoute, STREAM_PATH } from '@/server/bff/allowlist';
import type { Role } from '@/server/users';

const SPEC_PATH = resolve(process.cwd(), '../api/openapi/openapi.yaml');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** ADR 0016: prices:read хватает роли viewer, остальные scope — только operator */
const SCOPE_ROLE: Record<string, Role> = {
  'prices:read': 'viewer',
  'watchlist:write': 'operator',
  'ops:read': 'operator',
  'ops:write': 'operator',
};

type Operation = { operationId: string; method: string; path: string; role: Role };

function readOperations(): Operation[] {
  const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = item[method] as { operationId: string; 'x-required-scopes'?: string[] } | undefined;
      if (!operation) continue;
      const roles = (operation['x-required-scopes'] ?? []).map((scope) => {
        const role = SCOPE_ROLE[scope];
        if (!role)
          throw new Error(`${operation.operationId}: scope ${scope} не сопоставлен роли — дополните SCOPE_ROLE`);
        return role;
      });
      // Операция без scope (health) открыта любому вошедшему пользователю
      const role: Role = roles.includes('operator') ? 'operator' : 'viewer';
      operations.push({ operationId: operation.operationId, method: method.toUpperCase(), path, role });
    }
  }
  return operations;
}

const key = (route: { method: string; path: string }) => `${route.method} ${route.path}`;

describe('[bff] allowlist ↔ openapi.yaml', () => {
  const operations = readOperations();
  const proxied = operations.filter((operation) => operation.path !== STREAM_PATH);

  it('✅ в контракте 16 операций, в таблице — все, кроме потока событий', () => {
    expect(operations).toHaveLength(16);
    expect(ALLOWLIST.map(key).sort()).toEqual(proxied.map(key).sort());
  });

  it.each(proxied.map((operation) => [operation.operationId, operation] as const))(
    '✅ %s: роль в таблице соответствует x-required-scopes',
    (_id, operation) => {
      const route = ALLOWLIST.find((candidate) => key(candidate) === key(operation));
      expect(route?.role).toBe(operation.role);
    },
  );

  it('✅ потоку событий хватает роли viewer: /api/stream ходит в api ключом viewer', () => {
    const stream = operations.find((operation) => operation.path === STREAM_PATH);
    expect(stream).toMatchObject({ operationId: 'streamEvents', method: 'GET', role: 'viewer' });
  });

  it('✅ в таблице нет повторов', () => {
    expect(new Set(ALLOWLIST.map(key)).size).toBe(ALLOWLIST.length);
  });
});

describe('[bff] matchRoute', () => {
  it.each([
    ['GET', '/api/v1/prices', '/api/v1/prices'],
    ['GET', '/api/v1/prices/sparklines', '/api/v1/prices/sparklines'],
    ['GET', '/api/v1/cryptocurrencies/42', '/api/v1/cryptocurrencies/{id}'],
    ['DELETE', '/api/v1/cryptocurrencies/42', '/api/v1/cryptocurrencies/{id}'],
    ['GET', '/api/v1/cryptocurrencies/42/prices/aggregates', '/api/v1/cryptocurrencies/{id}/prices/aggregates'],
    ['GET', '/health/ready', '/health/ready'],
  ])('✅ %s %s → %s', (method, pathname, expected) => {
    expect(matchRoute(method, pathname)?.path).toBe(expected);
  });

  it.each([
    ['поток — у него свой маршрут', 'GET', '/api/v1/stream'],
    ['метода нет в контракте', 'PUT', '/api/v1/cryptocurrencies/42'],
    ['метод в нижнем регистре', 'get', '/api/v1/prices'],
    ['пути нет в контракте', 'GET', '/api/v1/api-keys'],
    ['документация api', 'GET', '/docs'],
    ['лишний сегмент', 'GET', '/api/v1/prices/sparklines/extra'],
    ['завершающая косая черта', 'GET', '/api/v1/prices/'],
    ['пустой параметр', 'GET', '/api/v1/cryptocurrencies/'],
    ['закодированная косая черта в параметре', 'GET', '/api/v1/cryptocurrencies/1%2Fprices'],
    ['точки в параметре', 'GET', '/api/v1/cryptocurrencies/..'],
    ['пустой путь', 'GET', ''],
  ])('❌ %s → нет совпадения', (_name, method, pathname) => {
    expect(matchRoute(method, pathname)).toBeNull();
  });

  it('✅ оператору доступно всё, что доступно viewer, но не наоборот', () => {
    expect(hasRole('operator', 'viewer')).toBe(true);
    expect(hasRole('operator', 'operator')).toBe(true);
    expect(hasRole('viewer', 'viewer')).toBe(true);
    expect(hasRole('viewer', 'operator')).toBe(false);
  });
});
