// e2e остановки (C6): настоящий процесс `node src/server.ts`, настоящий SIGTERM. Проверяет то, чего не видит
// unit-тест координатора: сигнал доходит до процесса, код выхода 0, WAL сброшен в файл БД.
// На Windows SIGTERM не доставляется (child.kill там — принудительное завершение), поэтому тест идёт на Linux: CI и Docker.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCmcStub, STUB_API_KEY, type CmcStub } from '../../scripts/cmc-stub.ts';

const API_DIR = join(__dirname, '..', '..');
const VIEWER_KEY = `cpt_${'e'.repeat(43)}`;
const onPosix = process.platform === 'win32' ? describe.skip : describe;

async function freePort(): Promise<number> {
  const probe = createServer().listen(0);
  await new Promise((resolve) => probe.once('listening', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

onPosix('e2e: SIGTERM останавливает процесс корректно', () => {
  let stub: CmcStub;
  let dataDir: string;

  beforeEach(async () => {
    stub = await startCmcStub();
    dataDir = mkdtempSync(join(tmpdir(), 'cpt-e2e-'));
  });
  afterEach(async () => {
    await stub.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('SSE-клиент получает shutdown, код выхода 0, WAL-файла не остаётся', async () => {
    const port = await freePort();
    const databasePath = join(dataDir, 'cpt.db');
    const child = spawn(process.execPath, ['src/server.ts'], {
      cwd: API_DIR,
      env: {
        PATH: process.env['PATH'],
        PORT: String(port),
        DATABASE_PATH: databasePath,
        CMC_API_KEY: STUB_API_KEY,
        CMC_BASE_URL: stub.url,
        BOOTSTRAP_VIEWER_KEY: VIEWER_KEY,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );

    try {
      // Планировщик стартует после listen: ждём его, чтобы сигнал пришёл в полностью поднятый сервис
      while (!stdout.includes('scheduler started')) {
        if (child.exitCode !== null) throw new Error(`сервер не стартовал:\n${stdout}\n${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const stream = await new Promise<http.IncomingMessage>((resolve, reject) => {
        http
          .get({ port, path: '/api/v1/stream', headers: { Authorization: `Bearer ${VIEWER_KEY}` } }, resolve)
          .on('error', reject);
      });
      expect(stream.statusCode).toBe(200);
      let events = '';
      stream.setEncoding('utf8').on('data', (chunk: string) => (events += chunk));
      const streamEnded = new Promise((resolve) => stream.once('end', resolve));

      const signalledAt = Date.now();
      child.kill('SIGTERM');
      const result = await exited;
      await streamEnded;

      expect(result).toEqual({ code: 0, signal: null });
      expect(events).toContain('event: shutdown');
      expect(stdout).toContain('"msg":"shutdown started","signal":"SIGTERM"');
      expect(stdout).toContain('"msg":"shutdown complete"');
      expect(stderr).toBe('');
      // Без closeIdleConnections и закрытия SSE остановка упёрлась бы в grace (10 с)
      expect(Date.now() - signalledAt).toBeLessThan(5000);
      // db.close() сделал чекпоинт: изменения в основном файле, журнала нет
      expect(existsSync(databasePath)).toBe(true);
      expect(existsSync(`${databasePath}-wal`)).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  }, 20_000);
});
