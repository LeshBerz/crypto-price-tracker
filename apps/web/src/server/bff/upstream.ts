// Запрос из BFF в apps/api: ключ по роли подставляется здесь и нигде больше (ADR 0002, 0016).
import type { ApiConfig } from '../config';
import type { Role } from '../users';

export type UpstreamFailure = 'timeout' | 'unavailable' | 'client-closed';

export class UpstreamError extends Error {
  override name = 'UpstreamError';
  readonly failure: UpstreamFailure;

  constructor(failure: UpstreamFailure, cause: unknown) {
    // Текст причины — код ошибки сети (ECONNREFUSED и т. п.); заголовков запроса и ключа в нём нет
    super(failure, { cause });
    this.failure = failure;
  }
}

export type UpstreamRequest = {
  role: Role;
  method: string;
  /** Путь api со строкой запроса: проверен allowlist или задан кодом */
  pathAndQuery: string;
  requestId: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer;
  /** Сигнал входящего запроса: клиент ушёл — запрос в api отменяется */
  signal: AbortSignal;
  /**
   * true — долгоживущий ответ (SSE): таймаут действует только до заголовков ответа.
   * false — таймаут накрывает и чтение тела, тело возвращается целиком.
   */
  stream?: boolean;
};

export type ApiFetch = (input: string, init: RequestInit) => Promise<Response>;

export function keyForRole(config: ApiConfig, role: Role): string {
  return role === 'operator' ? config.operatorKey : config.viewerKey;
}

export async function callApi(config: ApiConfig, apiFetch: ApiFetch, request: UpstreamRequest): Promise<Response> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), config.timeoutMs);
  try {
    const response = await apiFetch(config.baseUrl + request.pathAndQuery, {
      method: request.method,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${keyForRole(config, request.role)}`,
        'X-Request-Id': request.requestId,
      },
      body: request.body,
      signal: AbortSignal.any([request.signal, timeout.signal]),
      // Ответы api зависят от ключа и меняются каждую синхронизацию — кэш Next им не нужен
      cache: 'no-store',
      // Перенаправление от api — не часть контракта: за ним BFF не идёт
      redirect: 'manual',
    });
    if (request.stream) return response;
    // Тело читается до конца под тем же таймаутом: клиент получает либо полный ответ, либо 504, но не обрывок
    const body = response.status === 204 || response.status === 304 ? null : await response.arrayBuffer();
    return new Response(body, { status: response.status, headers: response.headers });
  } catch (error) {
    if (request.signal.aborted) throw new UpstreamError('client-closed', error);
    throw new UpstreamError(timeout.signal.aborted ? 'timeout' : 'unavailable', error);
  } finally {
    clearTimeout(timer);
  }
}

/** Код сетевой ошибки для лога: fetch прячет его в cause */
export function failureCode(error: UpstreamError): string | undefined {
  const cause = error.cause as { cause?: { code?: unknown }; code?: unknown; name?: unknown } | undefined;
  const code = cause?.cause?.code ?? cause?.code ?? cause?.name;
  return typeof code === 'string' ? code : undefined;
}
