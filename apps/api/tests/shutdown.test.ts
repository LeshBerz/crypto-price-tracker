// Координатор остановки (C6, ADR 0015 §5). Сигналы — внедрённый EventEmitter, exit — шпион, время — FakeClock:
// порядок шагов и таймауты проверяются без настоящего процесса. В конце — настоящий http-сервер с SSE и keep-alive.
import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { GRACE_MS, ShutdownCoordinator, WATCHDOG_MS, type ShutdownDeps } from '../src/shutdown.ts';
import { bearer, TOKENS } from './helpers/auth.ts';
import { createTestApp } from './helpers/app.ts';
import { FakeClock } from './helpers/fake-clock.ts';
import { createSpyLogger } from './helpers/logger.ts';

const tick = () => new Promise((next) => setImmediate(next));

/** Фейки всех участников: каждый вызов пишется в calls, «зависания» включаются флагами */
function setup(options: { syncHangs?: 'until-abort' | 'forever'; connectionsHang?: boolean; dbFails?: boolean } = {}) {
  const clock = new FakeClock();
  const { logger, entries } = createSpyLogger(clock);
  const calls: string[] = [];
  const exits: number[] = [];
  const signals = new EventEmitter();

  let releaseSync: () => void = () => undefined;
  const syncDone = options.syncHangs ? new Promise<void>((resolve) => (releaseSync = resolve)) : Promise.resolve();
  let onClosed: () => void = () => undefined;

  const deps: ShutdownDeps = {
    server: {
      close: (callback) => {
        calls.push('server.close');
        onClosed = callback;
        if (!options.connectionsHang) callback();
      },
      closeIdleConnections: () => calls.push('server.closeIdleConnections'),
      closeAllConnections: () => {
        calls.push('server.closeAllConnections');
        onClosed();
      },
    },
    scheduler: {
      stop: () => {
        calls.push('scheduler.stop');
        return Promise.resolve();
      },
    },
    sync: {
      idle: () => syncDone,
      abort: (reason) => {
        calls.push(`sync.abort(${reason.message})`);
        if (options.syncHangs === 'until-abort') releaseSync();
      },
    },
    sse: { closeAll: () => calls.push('sse.closeAll') },
    db: {
      close: () => {
        calls.push('db.close');
        if (options.dbFails) throw new Error('database is locked');
      },
    },
    clock,
    logger,
    exit: (code) => exits.push(code),
  };
  const coordinator = new ShutdownCoordinator(deps);
  coordinator.listen(signals);
  return { coordinator, signals, calls, exits, clock, logs: entries };
}

describe('ShutdownCoordinator: порядок шагов', () => {
  it('SIGTERM: шаги по порядку ADR 0015, exit(0), таймеры сняты', async () => {
    const { coordinator, signals, calls, exits, clock, logs } = setup();
    expect(coordinator.isShuttingDown()).toBe(false);

    signals.emit('SIGTERM');
    // Шаг 0: флаг поднят синхронно — readiness отвечает 503 раньше, чем начнут закрываться соединения
    expect(coordinator.isShuttingDown()).toBe(true);
    await tick();

    expect(calls).toEqual([
      'scheduler.stop',
      'server.close',
      'sse.closeAll',
      'server.closeIdleConnections',
      'server.closeIdleConnections',
      'db.close',
    ]);
    expect(exits).toEqual([0]);
    expect(clock.pendingSleeps).toBe(0);
    expect(logs().map((entry) => entry.msg)).toEqual(['shutdown started', 'shutdown complete']);
    expect(logs()[0]).toMatchObject({ signal: 'SIGTERM', graceMs: GRACE_MS });
  });

  it('повторный сигнал во время остановки игнорируется', async () => {
    const { signals, calls, exits, logs } = setup();
    signals.emit('SIGTERM');
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    await tick();

    expect(calls.filter((call) => call === 'scheduler.stop')).toHaveLength(1);
    expect(calls.filter((call) => call === 'db.close')).toHaveLength(1);
    expect(exits).toEqual([0]);
    expect(logs().filter((entry) => entry.msg === 'shutdown already in progress')).toHaveLength(2);
  });

  it('SIGINT останавливает так же, как SIGTERM', async () => {
    const { signals, exits } = setup();
    signals.emit('SIGINT');
    await tick();
    expect(exits).toEqual([0]);
  });
});

describe('ShutdownCoordinator: таймауты', () => {
  it('синхронизация не уложилась в grace — прерывается, остановка завершается с 0', async () => {
    const { signals, calls, exits, clock, logs } = setup({ syncHangs: 'until-abort' });
    signals.emit('SIGTERM');

    await clock.advance(GRACE_MS - 1);
    expect(calls).not.toContain('sync.abort(shutdown)');
    expect(calls).not.toContain('db.close');
    expect(exits).toEqual([]);

    await clock.advance(1);
    await tick();
    expect(calls.slice(4)).toEqual(['sync.abort(shutdown)', 'server.closeIdleConnections', 'db.close']);
    expect(exits).toEqual([0]);
    expect(logs().some((entry) => entry.msg === 'sync did not finish in time: aborting')).toBe(true);
  });

  it('соединения не закрылись за grace — closeAllConnections', async () => {
    const { signals, calls, exits, clock } = setup({ connectionsHang: true });
    signals.emit('SIGTERM');

    await clock.advance(GRACE_MS - 1);
    expect(calls).not.toContain('server.closeAllConnections');

    await clock.advance(1);
    await tick();
    expect(calls.slice(-2)).toEqual(['server.closeAllConnections', 'db.close']);
    expect(exits).toEqual([0]);
  });

  it('сторожевой таймер: шаг завис — exit(1) через 15 с, и только один раз', async () => {
    const { signals, calls, exits, clock, logs } = setup({ syncHangs: 'forever' });
    signals.emit('SIGTERM');

    await clock.advance(WATCHDOG_MS - 1);
    expect(exits).toEqual([]);
    await clock.advance(1);
    expect(exits).toEqual([1]);
    expect(calls).not.toContain('db.close');
    expect(logs().some((entry) => entry.msg === 'shutdown watchdog fired: forcing exit')).toBe(true);
  });

  it('шаг бросил ошибку — exit(1), ошибка в логе', async () => {
    const { signals, exits, clock, logs } = setup({ dbFails: true });
    signals.emit('SIGTERM');
    await tick();

    expect(exits).toEqual([1]);
    expect(clock.pendingSleeps).toBe(0);
    expect(logs().find((entry) => entry.msg === 'shutdown failed')).toMatchObject({
      level: 'error',
      error: { message: 'database is locked' },
    });
  });
});

describe('остановка настоящего http-сервера (ловушки из ADR 0015: SSE и keep-alive)', () => {
  it('SSE-клиент получает shutdown, keep-alive сокет закрыт, readiness 503 — без ожидания grace', async () => {
    let coordinator: ShutdownCoordinator | null = null;
    const { app, db, clock, logger, sync, sse } = await createTestApp({
      lifecycle: { isShuttingDown: () => coordinator?.isShuttingDown() ?? false, schedulerState: () => 'stopped' },
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const exits: number[] = [];
    coordinator = new ShutdownCoordinator({
      server,
      scheduler: { stop: () => Promise.resolve() },
      sync,
      sse,
      db,
      clock,
      logger,
      exit: (code) => exits.push(code),
    });

    // Простаивающее keep-alive соединение: без closeIdleConnections сервер ждал бы его keepAliveTimeout
    const agent = new http.Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      http
        .get({ port, path: '/health/live', agent }, (res) => {
          res.resume();
          res.once('end', resolve);
        })
        .on('error', reject);
    });
    const own = await new Promise<http.IncomingMessage>((resolve, reject) => {
      http
        .get({ port, path: '/api/v1/stream', headers: bearer(TOKENS.viewer), agent: false }, resolve)
        .on('error', reject);
    });
    let text = '';
    own.setEncoding('utf8').on('data', (chunk: string) => (text += chunk));
    const ownEnded = new Promise((resolve) => own.once('end', resolve));
    expect(await request(app).get('/health/ready')).toMatchContract('getReadiness', 200);

    try {
      const stopped = coordinator.shutdown('SIGTERM');
      expect(await request(app).get('/health/ready')).toMatchContract('getReadiness', 503);
      // FakeClock не двигаем: если бы остановка дожидалась grace, тест завис бы и упал по таймауту
      await stopped;
      await ownEnded;

      expect(text).toContain('event: shutdown');
      expect(exits).toEqual([0]);
      expect(server.listening).toBe(false);
      expect(() => db.prepare('SELECT 1').get()).toThrow();
    } finally {
      agent.destroy();
    }
  });
});
