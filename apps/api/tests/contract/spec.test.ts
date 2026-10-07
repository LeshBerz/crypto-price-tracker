// Инварианты контракта, на которые опираются роутер и матрица C8 (ADR 0002, 0008, 0014).
// Ловят ошибку в спеке до того, как она станет ошибкой старта приложения.
import { openapiDocument } from '../../src/generated/openapi.ts';

type Operation = {
  operationId?: string;
  security?: unknown[];
  'x-required-scopes'?: string[];
  responses?: Record<string, unknown>;
};
type Spec = { paths: Record<string, Record<string, Operation>> };

const SCOPES = ['prices:read', 'watchlist:write', 'ops:read', 'ops:write'];
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const spec = openapiDocument as Spec;
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => METHODS.includes(method))
    .map(([method, op]) => ({ path, method, op })),
);

describe('контракт openapi.yaml', () => {
  it('содержит 16 операций с уникальными operationId (ADR 0014)', () => {
    const ids = operations.map(({ op }) => op.operationId);
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
  });

  it.each(operations.map((o) => [o.op.operationId, o]))(
    '%s: публичная (security: []) или с известными scopes',
    (_id, { op }) => {
      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      const scopes = op['x-required-scopes'] ?? [];
      if (isPublic) {
        expect(scopes).toEqual([]);
      } else {
        expect(scopes.length).toBeGreaterThan(0);
        for (const scope of scopes) expect(SCOPES).toContain(scope);
      }
    },
  );

  it.each(operations.map((o) => [o.op.operationId, o]))(
    '%s: объявляет 400 — неизвестный query-параметр (поправка R1)',
    (_id, { op }) => {
      expect(op.responses).toHaveProperty('400');
    },
  );

  it.each(operations.filter((o) => o.op.security === undefined).map((o) => [o.op.operationId, o]))(
    '%s: защищённая операция объявляет 401 и 403 (RFC 6750)',
    (_id, { op }) => {
      expect(op.responses).toHaveProperty('401');
      expect(op.responses).toHaveProperty('403');
    },
  );
});
