import request from 'supertest';
import { openapiDocument } from '../src/generated/openapi.ts';
import type { Lifecycle } from '../src/health.ts';
import { bearer, TOKENS } from './helpers/auth.ts';
import { createTestApp, SCHEMA_VERSION } from './helpers/app.ts';

describe('[getLiveness] GET /health/live', () => {
  it('✅ 200 { status: "ok" } без ключа', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/health/live');
    expect(res).toMatchContract('getLiveness', 200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('❌ неизвестный query-параметр → 400 validation-error (поправка R1)', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/health/live?verbose=1');
    expect(res).toMatchContract('getLiveness', 400);
    expect(res.body.errors).toEqual([{ path: '/query/verbose', message: 'is not allowed' }]);
  });
});

describe('[getReadiness] GET /health/ready', () => {
  it('✅ 200: БД открыта, миграции применены', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/health/ready');
    expect(res).toMatchContract('getReadiness', 200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'ok', migrations: 'ok', scheduler: 'disabled' },
    });
  });

  it('❌ 503 во время остановки (readiness снята на шаге 0, ADR 0015)', async () => {
    const lifecycle: Lifecycle = { isShuttingDown: () => true, schedulerState: () => 'stopped' };
    const { app } = await createTestApp({ lifecycle });
    const res = await request(app).get('/health/ready');
    expect(res).toMatchContract('getReadiness', 503);
    expect(res.body).toEqual({
      status: 'fail',
      checks: { database: 'ok', migrations: 'ok', scheduler: 'stopped' },
    });
  });

  it('❌ 503: БД недоступна', async () => {
    const { app, db } = await createTestApp();
    db.close();
    const res = await request(app).get('/health/ready');
    expect(res).toMatchContract('getReadiness', 503);
    expect(res.body.checks).toMatchObject({ database: 'fail', migrations: 'fail' });
  });

  it('❌ 503: схема БД не той версии, что знает код', async () => {
    const { app } = await createTestApp({ schemaVersion: SCHEMA_VERSION + 1 });
    const res = await request(app).get('/health/ready');
    expect(res).toMatchContract('getReadiness', 503);
    expect(res.body.checks).toMatchObject({ database: 'ok', migrations: 'fail' });
  });
});

describe('createApp: документация (F8)', () => {
  it('/openapi.json отдаёт спеку', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(openapiDocument);
  });

  it('/docs отдаёт Swagger UI', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('Crypto Price Tracker API');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});

describe('createApp: сквозное поведение', () => {
  it('X-Request-Id из запроса возвращается в ответе и попадает в access-лог', async () => {
    const { app, logs } = await createTestApp();
    const res = await request(app).get('/health/live').set('X-Request-Id', 'web-123');
    expect(res.headers['x-request-id']).toBe('web-123');
    expect(logs()).toContainEqual(
      expect.objectContaining({ msg: 'request completed', requestId: 'web-123', path: '/health/live', status: 200 }),
    );
  });

  it('не раскрывает фреймворк (X-Powered-By)', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('неизвестный путь → 404 Problem', async () => {
    const { app } = await createTestApp();
    expect(await request(app).get('/nope')).toBeProblem(404, 'not-found');
  });

  it('операция без реализации пока отвечает 500 internal-error', async () => {
    const { app } = await createTestApp();
    const res = await request(app).get('/api/v1/stream').set(bearer(TOKENS.viewer));
    expect(res).toBeProblem(500, 'internal-error');
    expect(res.body.detail).toBe('Operation streamEvents is not implemented yet');
  });
});
