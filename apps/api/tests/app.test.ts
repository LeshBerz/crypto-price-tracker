import request from 'supertest';
import { createApp } from '../src/app.ts';
import { silentLogger } from '../src/common/logger.ts';
import { openapiDocument } from '../src/generated/openapi.ts';
import type { Lifecycle } from '../src/health.ts';
import { bearer, TOKENS } from './helpers/auth.ts';
import { createTestApp, SCHEMA_VERSION } from './helpers/app.ts';
import { createTestDb } from './helpers/db.ts';
import { FakeClock } from './helpers/fake-clock.ts';

describe('[getLiveness] GET /health/live', () => {
  it('✅ 200 { status: "ok" } без ключа', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health/live');
    expect(res).toMatchContract('getLiveness', 200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('❌ неизвестный query-параметр → 400 validation-error (поправка R1)', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health/live?verbose=1');
    expect(res).toMatchContract('getLiveness', 400);
    expect(res.body.errors).toEqual([{ path: '/query/verbose', message: 'is not allowed' }]);
  });
});

describe('[getReadiness] GET /health/ready', () => {
  it('✅ 200: БД открыта, миграции применены', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health/ready');
    expect(res).toMatchContract('getReadiness', 200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'ok', migrations: 'ok', scheduler: 'disabled' },
    });
  });

  it('❌ 503 во время остановки (readiness снята на шаге 0, ADR 0015)', async () => {
    const lifecycle: Lifecycle = { isShuttingDown: () => true, schedulerState: () => 'stopped' };
    const { app } = createTestApp({ lifecycle });
    const res = await request(app).get('/health/ready');
    expect(res).toMatchContract('getReadiness', 503);
    expect(res.body).toEqual({
      status: 'fail',
      checks: { database: 'ok', migrations: 'ok', scheduler: 'stopped' },
    });
  });

  it('❌ 503: БД недоступна', async () => {
    const { app, db } = createTestApp();
    db.close();
    const res = await request(app).get('/health/ready');
    expect(res).toMatchContract('getReadiness', 503);
    expect(res.body.checks).toMatchObject({ database: 'fail', migrations: 'fail' });
  });

  it('❌ 503: схема БД не той версии, что знает код', async () => {
    const { app } = createTestApp({ schemaVersion: SCHEMA_VERSION + 1 });
    const res = await request(app).get('/health/ready');
    expect(res).toMatchContract('getReadiness', 503);
    expect(res.body.checks).toMatchObject({ database: 'ok', migrations: 'fail' });
  });
});

describe('createApp: документация (F8)', () => {
  it('/openapi.json отдаёт спеку', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(openapiDocument);
  });

  it('/docs отдаёт Swagger UI', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('Crypto Price Tracker API');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});

describe('createApp: сквозное поведение', () => {
  it('X-Request-Id из запроса возвращается в ответе и попадает в access-лог', async () => {
    const { app, logs } = createTestApp();
    const res = await request(app).get('/health/live').set('X-Request-Id', 'web-123');
    expect(res.headers['x-request-id']).toBe('web-123');
    expect(logs()).toContainEqual(
      expect.objectContaining({ msg: 'request completed', requestId: 'web-123', path: '/health/live', status: 200 }),
    );
  });

  it('не раскрывает фреймворк (X-Powered-By)', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('неизвестный путь → 404 Problem', async () => {
    const { app } = createTestApp();
    expect(await request(app).get('/nope')).toBeProblem(404, 'not-found');
  });

  it('по умолчанию (до B8) защищённые операции закрыты: denyAll → 401', async () => {
    const app = createApp({
      db: createTestDb(),
      schemaVersion: SCHEMA_VERSION,
      logger: silentLogger,
      clock: new FakeClock(),
    });
    const res = await request(app).get('/api/v1/prices').set(bearer(TOKENS.operator));
    expect(res).toMatchContract('listLatestPrices', 401);
  });

  it('операция без реализации пока отвечает 500 internal-error по контракту', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/v1/prices').set(bearer(TOKENS.viewer));
    expect(res).toMatchContract('listLatestPrices', 500);
    expect(res.body.detail).toBe('Operation listLatestPrices is not implemented yet');
  });
});
