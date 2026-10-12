// GET /api/stream — SSE-прокси к /api/v1/stream (ADR 0016). Сессия перепроверяется на каждом heartbeat api:
// после выхода, отзыва или отключения пользователя открытый поток закрывается не позже чем через 25 секунд.
import { randomUUID } from 'node:crypto';
import type { Services } from '../container';
import { problem } from '../problem';
import { readSessionToken } from '../request';
import { STREAM_PATH } from './allowlist';
import { callApi } from './upstream';
import { pickHeaders, relayOrRejectKey, upstreamProblem } from './bff-http';

/** api шлёт heartbeat раз в 25 с; два пропуска подряд — соединение с api считается зависшим */
export const STREAM_IDLE_MS = 60_000;

const HEARTBEAT_LINE = 'event: heartbeat';
/** Событие самого web: клиент узнаёт причину закрытия сразу, а не по ответу 401 на переподключение */
const SESSION_EXPIRED_EVENT = '\n\nevent: session.expired\ndata: {}\n\n';
/** Строка SSE длиннее этого — не событие контракта; хвост сбрасывается, чтобы буфер не рос */
const MAX_LINE_CHARS = 64 * 1024;

export type StreamGuard = {
  /** Вызывается на каждом heartbeat; false — поток закрывается */
  isSessionValid: () => boolean;
  idleMs: number;
};

/**
 * Пропускает байты api без изменений и попутно читает их как текст: ищет строку `event: heartbeat`.
 * Событие может прийти разрезанным на несколько чанков, поэтому неоконченная строка ждёт продолжения в `tail`.
 */
export function guardStream(upstream: ReadableStream<Uint8Array>, guard: StreamGuard): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let tail = '';
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  // Отмена чтения закрывает и запрос к api: read() ниже вернёт done
  const stop = () => void reader.cancel().catch(() => undefined);
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, guard.idleMs);
  };

  const sawHeartbeat = (chunk: Uint8Array): boolean => {
    const lines = (tail + decoder.decode(chunk, { stream: true })).split('\n');
    tail = lines.pop() ?? '';
    if (tail.length > MAX_LINE_CHARS) tail = '';
    return lines.some((line) => line.trimEnd() === HEARTBEAT_LINE);
  };

  return new ReadableStream<Uint8Array>({
    start() {
      armIdleTimer();
    },
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        // Обрыв соединения с api: поток закрывается штатно, EventSource переподключится сам
        result = { done: true, value: undefined };
      }
      if (result.done) {
        clearTimeout(idleTimer);
        controller.close();
        return;
      }
      armIdleTimer();
      if (sawHeartbeat(result.value) && !guard.isSessionValid()) {
        clearTimeout(idleTimer);
        controller.enqueue(new TextEncoder().encode(SESSION_EXPIRED_EVENT));
        controller.close();
        stop();
        return;
      }
      controller.enqueue(result.value);
    },
    // Клиент закрыл вкладку или EventSource
    cancel() {
      clearTimeout(idleTimer);
      stop();
    },
  });
}

export async function handleStream(request: Request, services: Services): Promise<Response> {
  const requestId = randomUUID();
  const token = readSessionToken(request);
  // touch: false — открытая вкладка с потоком не считается активностью пользователя и не продлевает сессию
  const isSessionValid = () => services.sessions.validate(token, { touch: false }) !== null;
  const session = services.sessions.validate(token, { touch: false });
  if (!session) return problem(401, 'unauthorized', { requestId }, { 'X-Request-Id': requestId });
  if (session.mustChangePassword) {
    return problem(403, 'password-change-required', { requestId }, { 'X-Request-Id': requestId });
  }

  let upstream: Response;
  try {
    upstream = await callApi(services.config.api, services.apiFetch, {
      // Потоку хватает prices:read, поэтому ключ viewer — при любой роли сессии (минимум прав)
      role: 'viewer',
      method: 'GET',
      pathAndQuery: STREAM_PATH,
      requestId,
      headers: { accept: 'text/event-stream', ...pickHeaders(request.headers, ['last-event-id']) },
      signal: request.signal,
      stream: true,
    });
  } catch (error) {
    return upstreamProblem(error, requestId, services, `GET ${STREAM_PATH}`);
  }
  // Отказ api (503 при остановке) — обычный ответ с Problem, а не поток; 401 по ключу становится 502
  if (!upstream.ok || !upstream.body) return relayOrRejectKey(upstream, requestId, services, `GET ${STREAM_PATH}`);

  return new Response(guardStream(upstream.body, { isSessionValid, idleMs: STREAM_IDLE_MS }), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform и X-Accel-Buffering — чтобы прокси перед web не сжимал и не копил события
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': requestId,
    },
  });
}
