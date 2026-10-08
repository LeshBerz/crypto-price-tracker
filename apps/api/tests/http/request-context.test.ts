import express from 'express';
import request from 'supertest';
import { requestContext, VALID_REQUEST_ID } from '../../src/http/request-context.ts';
import { FakeClock } from '../helpers/fake-clock.ts';
import { createSpyLogger } from '../helpers/logger.ts';

function setup() {
  const clock = new FakeClock();
  const { logger, entries } = createSpyLogger(clock);
  const app = express();
  app.use(requestContext({ logger, clock, generateId: () => 'generated-id' }));
  app.get('/ok', async (_req, res) => {
    res.locals.log.info('inside handler');
    await clock.advance(42);
    res.json({ requestId: res.locals.requestId });
  });
  return { app, entries };
}

describe('requestContext', () => {
  it('генерирует X-Request-Id, кладёт его в res.locals и в каждую запись лога', async () => {
    const { app, entries } = setup();
    const res = await request(app).get('/ok?secret=1');
    expect(res.headers['x-request-id']).toBe('generated-id');
    expect(res.body).toEqual({ requestId: 'generated-id' });
    expect(entries()).toEqual([
      expect.objectContaining({ msg: 'inside handler', requestId: 'generated-id' }),
      expect.objectContaining({
        level: 'info',
        msg: 'request completed',
        requestId: 'generated-id',
        method: 'GET',
        path: '/ok',
        status: 200,
        durationMs: 42,
      }),
    ]);
  });

  it('переиспользует валидный входящий X-Request-Id (корреляция web → api)', async () => {
    const { app } = setup();
    const id = 'a'.repeat(64);
    const res = await request(app).get('/ok').set('X-Request-Id', id);
    expect(res.headers['x-request-id']).toBe(id);
  });

  it.each([
    ['длиннее 64 символов', 'a'.repeat(65)],
    ['с пробелом — попытка подделать строку лога', 'abc def'],
    ['с кавычкой', 'abc"def'],
  ])('заменяет входящий id %s', async (_case, id) => {
    const { app } = setup();
    const res = await request(app).get('/ok').set('X-Request-Id', id);
    expect(res.headers['x-request-id']).toBe('generated-id');
  });

  it('по умолчанию генерирует UUID', async () => {
    const { logger } = createSpyLogger();
    const app = express();
    app.use(requestContext({ logger, clock: new FakeClock() }));
    app.get('/', (_req, res) => res.end());
    const res = await request(app).get('/');
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(VALID_REQUEST_ID.test(String(res.headers['x-request-id']))).toBe(true);
  });

  it('обрыв соединения клиентом логируется как warn', async () => {
    const { logger, entries } = createSpyLogger();
    const app = express();
    app.use(requestContext({ logger, clock: new FakeClock() }));
    let closed!: () => void;
    const done = new Promise<void>((resolve) => (closed = resolve));
    app.get('/slow', (_req, res) => {
      res.on('close', () => setImmediate(closed));
      res.write('partial');
    });
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${port}/slow`, { signal: controller.signal });
      expect(response.status).toBe(200);
      controller.abort();
      await done;
    } finally {
      server.close();
    }
    expect(entries()).toEqual([
      expect.objectContaining({ level: 'warn', msg: 'request aborted by client', path: '/slow' }),
    ]);
  });
});
