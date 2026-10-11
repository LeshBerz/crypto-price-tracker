// Клиент SSE для тестов: поток не заканчивается сам, поэтому supertest здесь не подходит —
// поднимаем приложение на случайном порту и читаем ответ через node:http.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { ResponseUnderTest } from '../../src/openapi/spec.ts';

export type SseFrame = { id?: string; event?: string; data?: unknown };

export type SseClient = {
  /** Статус и заголовки для toMatchContract; text — всё, что пришло к этому моменту */
  response(): ResponseUnderTest;
  frames(): SseFrame[];
  /** Ждёт кадр с таким event; уже полученные тоже считаются */
  waitFor(event: string): Promise<SseFrame>;
  /** Сервер закрыл поток (res.end) */
  ended: Promise<void>;
  close(): Promise<void>;
};

export function parseFrames(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '' && !block.startsWith(':'))
    .map((block) => {
      const frame: SseFrame = {};
      for (const line of block.split('\n')) {
        const [field, ...rest] = line.split(': ');
        const value = rest.join(': ');
        if (field === 'id') frame.id = value;
        if (field === 'event') frame.event = value;
        if (field === 'data') frame.data = JSON.parse(value);
      }
      return frame;
    });
}

export async function openStream(app: Express, headers: Record<string, string>): Promise<SseClient> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  let text = '';
  const listeners = new Set<() => void>();
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http.get({ port, path: '/api/v1/stream', headers, agent: false }, resolve).on('error', reject);
  });
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    text += chunk;
    for (const notify of [...listeners]) notify();
  });
  const ended = new Promise<void>((resolve) => res.once('end', resolve));

  const frames = () => parseFrames(text);
  return {
    response: () => ({ status: res.statusCode ?? 0, headers: res.headers, body: undefined, text }),
    frames,
    waitFor: (event) =>
      new Promise((resolve) => {
        const check = () => {
          const found = frames().find((frame) => frame.event === event);
          if (!found) return;
          listeners.delete(check);
          resolve(found);
        };
        listeners.add(check);
        check();
      }),
    ended,
    close: async () => {
      res.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
