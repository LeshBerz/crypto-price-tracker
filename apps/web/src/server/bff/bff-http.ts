// /api/bff/[...path] — прокси в apps/api (ADR 0016). Порядок проверок: сессия → allowlist → роль → CSRF → запрос.
import { randomUUID } from 'node:crypto';
import type { Services } from '../container';
import { problem } from '../problem';
import { isJsonRequest, isSameOrigin, readSessionToken } from '../request';
import { hasRole, matchRoute } from './allowlist';
import { callApi, failureCode, UpstreamError } from './upstream';

export const BFF_PREFIX = '/api/bff';

/** Тела запросов контракта — десятки байт JSON; предел отсекает мусор раньше, чем он уйдёт в api */
export const MAX_BODY_BYTES = 64 * 1024;

/** Из запроса браузера в api уходят только эти заголовки: cookie сессии и всё остальное остаётся в web */
const FORWARDED_REQUEST_HEADERS = ['accept', 'content-type'];

/**
 * Из ответа api в браузер уходят только эти заголовки. Content-Length и Content-Encoding не копируются: fetch уже
 * распаковал тело, длину считает сам Response.
 */
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'location', 'retry-after', 'x-request-id'];

export function pickHeaders(source: Headers, names: readonly string[]): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = source.get(name);
    if (value !== null) picked[name] = value;
  }
  return picked;
}

/** Ответ api как есть: статус, тело (в том числе Problem RFC 9457) и разрешённые заголовки */
export function relay(upstream: Response, requestId: string): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'x-request-id': requestId,
      ...pickHeaders(upstream.headers, FORWARDED_RESPONSE_HEADERS),
      // Ответ зависит от cookie сессии: ни браузер, ни промежуточный прокси его не кэшируют
      'cache-control': 'no-store',
    },
  });
}

export function upstreamProblem(error: unknown, requestId: string, services: Services, target: string): Response {
  if (!(error instanceof UpstreamError)) throw error;
  if (error.failure === 'client-closed') return new Response(null, { status: 499 });
  services.log('warn', 'api request failed', { requestId, target, failure: error.failure, code: failureCode(error) });
  return error.failure === 'timeout'
    ? problem(504, 'upstream-timeout', { requestId }, { 'X-Request-Id': requestId })
    : problem(502, 'upstream-unavailable', { requestId }, { 'X-Request-Id': requestId });
}

async function readBody(request: Request): Promise<ArrayBuffer | 'too-large' | undefined> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return 'too-large';
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return 'too-large';
  return body.byteLength === 0 ? undefined : body;
}

export async function handleBff(request: Request, services: Services): Promise<Response> {
  const requestId = randomUUID();
  const fail = (status: number, slug: Parameters<typeof problem>[1]) =>
    problem(status, slug, { requestId }, { 'X-Request-Id': requestId });

  // 401 раньше 404: без сессии нельзя узнать, какие маршруты существуют
  const session = services.sessions.validate(readSessionToken(request));
  if (!session) return fail(401, 'unauthorized');

  // URL уже нормализован: сегментов `..` и `.` в pathname нет, выйти за пределы таблицы ими нельзя
  const url = new URL(request.url);
  const apiPath = url.pathname.startsWith(`${BFF_PREFIX}/`) ? url.pathname.slice(BFF_PREFIX.length) : '';
  const route = matchRoute(request.method, apiPath);
  if (!route) return fail(404, 'not-found');
  if (!hasRole(session.role, route.role)) return fail(403, 'forbidden');

  let body: ArrayBuffer | undefined;
  if (route.method !== 'GET') {
    // Слои 2 и 3 защиты от CSRF (ADR 0016). У DELETE тела нет — для него остаётся проверка Origin
    if (route.method !== 'DELETE' && !isJsonRequest(request)) return fail(415, 'unsupported-media-type');
    if (!isSameOrigin(request, services.config.trustProxy)) return fail(403, 'forbidden-origin');
    const read = await readBody(request);
    if (read === 'too-large') return fail(413, 'payload-too-large');
    body = read;
  }

  try {
    const upstream = await callApi(services.config.api, services.apiFetch, {
      role: session.role,
      method: route.method,
      pathAndQuery: apiPath + url.search,
      requestId,
      headers: pickHeaders(request.headers, FORWARDED_REQUEST_HEADERS),
      body,
      signal: request.signal,
    });
    return relay(upstream, requestId);
  } catch (error) {
    return upstreamProblem(error, requestId, services, `${route.method} ${route.path}`);
  }
}
