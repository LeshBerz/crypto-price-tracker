// Табличный тест прав (ADR 0002, C8): каждая защищённая операция спеки с настоящим ApiKeyAuthenticator и ключами в SQLite.
// Операции берутся из спеки, поэтому новая операция попадает в таблицу без правки теста.
import request from 'supertest';
import { bearer, TOKENS } from '../helpers/auth.ts';
import { createTestApp } from '../helpers/app.ts';
import { spec } from '../helpers/contract.ts';
import type { OperationId } from '../../src/http/router.ts';

const PROTECTED = spec.operations
  .filter((op) => !op.isPublic)
  .map((op) => ({
    operationId: op.operationId as OperationId,
    method: op.method,
    // Параметры пути подставляем валидные: auth стоит раньше валидации, но путь должен совпасть с маршрутом
    path: op.expressPath.replace(/:\w+/g, '1'),
    scopes: op.requiredScopes.join(' '),
  }));

describe('матрица прав: 401 / 403 на каждой защищённой операции (RFC 6750)', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  it('в спеке 14 защищённых операций', () => {
    expect(PROTECTED).toHaveLength(14);
  });

  describe.each(PROTECTED)('$operationId $method $path', ({ operationId, method, path, scopes }) => {
    it('❌ без ключа → 401, WWW-Authenticate: Bearer', async () => {
      const res = await request(app)[method](path);
      expect(res).toMatchContract(operationId, 401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('❌ отозванный ключ → 401 invalid_token', async () => {
      const res = await request(app)[method](path).set(bearer(TOKENS.revoked));
      expect(res).toMatchContract(operationId, 401);
      expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    });

    it(`❌ ключ без scope ${scopes} → 403 insufficient_scope`, async () => {
      const res = await request(app)[method](path).set(bearer(TOKENS.noScopes));
      expect(res).toMatchContract(operationId, 403);
      expect(res.headers['www-authenticate']).toBe(`Bearer error="insufficient_scope", scope="${scopes}"`);
    });
  });
});
