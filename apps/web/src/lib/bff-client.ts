// Клиент BFF для браузера: путь, параметры и тип ответа берутся из сгенерированного контракта api (`paths`).
// Ключей api здесь нет: запрос идёт на свой origin с cookie сессии, ключ по роли подставляет сервер (ADR 0002).
import type { components, paths } from '@/generated/api-types';
import { BACKGROUND_HEADER, BFF_PREFIX, SESSION_EXPIRED_URL } from './bff-contract';

/** Пути контракта, у которых есть GET с JSON-ответом. Поток событий сюда не попадает: у него text/event-stream */
export type GetPath = {
  [P in keyof paths]: paths[P] extends { get: { responses: { 200: { content: { 'application/json': unknown } } } } }
    ? P
    : never;
}[keyof paths];

export type GetResponse<P extends GetPath> = paths[P]['get']['responses'][200]['content']['application/json'];
type QueryOf<P extends GetPath> = NonNullable<paths[P]['get']['parameters']['query']>;
type ParamsOf<P extends GetPath> = paths[P]['get']['parameters']['path'];

export type GetOptions<P extends GetPath> = {
  query?: QueryOf<P>;
  signal?: AbortSignal;
  /** Запрос без действия пользователя: срок бездействия сессии не продлевается */
  background?: boolean;
} & (ParamsOf<P> extends Record<string, unknown> ? { params: ParamsOf<P> } : { params?: never });

export type WriteMethod = 'post' | 'patch' | 'delete';

/** Операция контракта по пути и методу. Метода у пути нет — `never` (так его описывает openapi-typescript) */
type OperationOf<P extends keyof paths, M extends WriteMethod> = NonNullable<paths[P][M]>;

/** Пути контракта, у которых есть метод M: опечатка в пути или чужой метод — ошибка компиляции */
export type WritePath<M extends WriteMethod> = {
  [P in keyof paths]: [OperationOf<P, M>] extends [never] ? never : P;
}[keyof paths];

type JsonOf<T> = T extends { content: { 'application/json': infer Body } } ? Body : undefined;

/** Тело запроса операции; `never` — у операции тела нет (ручной запуск синхронизации, удаление) */
export type WriteBody<M extends WriteMethod, P extends WritePath<M>> =
  OperationOf<P, M> extends { requestBody: infer Body } ? JsonOf<Body> : never;

type SuccessStatus = 200 | 201 | 202 | 204;

/** Тело успешного ответа: JSON у 200 / 201 / 202, `undefined` у 204 */
export type WriteResponse<M extends WriteMethod, P extends WritePath<M>> =
  OperationOf<P, M> extends { responses: infer R }
    ? { [S in keyof R & SuccessStatus]: JsonOf<R[S]> }[keyof R & SuccessStatus]
    : never;

type WriteParams<M extends WriteMethod, P extends WritePath<M>> =
  OperationOf<P, M> extends { parameters: { path: infer Params } } ? Params : undefined;

export type WriteOptions<M extends WriteMethod, P extends WritePath<M>> = { signal?: AbortSignal } & ([
  WriteBody<M, P>,
] extends [never]
  ? { body?: never }
  : { body: WriteBody<M, P> }) &
  (WriteParams<M, P> extends Record<string, unknown> ? { params: WriteParams<M, P> } : { params?: never });

/**
 * Тело ошибки RFC 9457. `type` — строка, а не перечисление контракта: кроме `urn:cpt:problem:*` от api сюда
 * приходят `urn:cpt:web:problem:*` от самого BFF.
 */
export type Problem = Omit<components['schemas']['Problem'], 'type' | 'requestId'> & {
  type: string;
  requestId?: string;
};

/** Кто отказал: api (ответ передан как есть), web (BFF: сессия, allowlist, недоступность api) или сеть до web */
export type ErrorSource = 'api' | 'web' | 'network';

export class BffError extends Error {
  override readonly name = 'BffError';
  /** 0 — ответа нет: сеть недоступна или тело не разобрано */
  readonly status: number;
  readonly problem: Problem | null;
  /** Заголовок `Retry-After` в секундах: api ставит его на 503, когда недоступен CoinMarketCap */
  readonly retryAfterSeconds: number | null;
  /** Тело ответа, если это JSON, но не Problem: `/health/ready` отвечает 503 с тем же составом проверок */
  readonly body: unknown;

  constructor(
    status: number,
    problem: Problem | null,
    message?: string,
    extra: { retryAfterSeconds?: number | null; body?: unknown } = {},
  ) {
    super(message ?? problem?.title ?? `HTTP ${status}`);
    this.status = status;
    this.problem = problem;
    this.retryAfterSeconds = extra.retryAfterSeconds ?? null;
    this.body = extra.body;
  }

  get source(): ErrorSource {
    if (this.status === 0) return 'network';
    return this.problem?.type.startsWith('urn:cpt:web:') ? 'web' : 'api';
  }

  get requestId(): string | null {
    return this.problem?.requestId ?? null;
  }

  /** Данные недоступны не по вине запроса: нет сети, BFF не дозвался до api (502 / 504) или api ответил 5xx */
  get isUnavailable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof BffError && error.status === 401;
}

/** `{id}` в шаблоне пути заменяется значением, параметры запроса со значением `undefined` пропускаются */
export function buildBffUrl(
  path: string,
  params: Record<string, string | number> = {},
  query: Record<string, unknown> = {},
): string {
  const resolved = path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Не задан параметр пути {${name}}: ${path}`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.set(name, String(value));
  }
  const suffix = search.size > 0 ? `?${search}` : '';
  return `${BFF_PREFIX}${resolved}${suffix}`;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** `Retry-After` в секундах. Вариант с датой api не использует — он пропускается */
function readRetryAfter(response: Response): number | null {
  const value = response.headers.get('retry-after');
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

async function toError(response: Response): Promise<BffError> {
  const body = await readJson(response);
  const isProblem = typeof body === 'object' && body !== null && typeof (body as Problem).type === 'string';
  return new BffError(response.status, isProblem ? (body as Problem) : null, undefined, {
    retryAfterSeconds: readRetryAfter(response),
    body: isProblem ? undefined : body,
  });
}

export type BffClientDeps = {
  fetch: typeof globalThis.fetch;
  /** Сессии нет или она истекла: по умолчанию — переход на страницу входа */
  onUnauthorized: () => void;
};

export type BffClient = {
  get<P extends GetPath>(path: P, options?: GetOptions<P>): Promise<GetResponse<P>>;
  /**
   * Запись: POST, PATCH или DELETE. Признака фона у записи нет — за ней всегда стоит действие пользователя.
   * Ответ 204 возвращается как `undefined`.
   */
  send<M extends WriteMethod, P extends WritePath<M>>(
    method: M,
    path: P,
    options: WriteOptions<M, P>,
  ): Promise<WriteResponse<M, P>>;
};

export function createBffClient(deps: BffClientDeps): BffClient {
  async function request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await deps.fetch(url, { ...init, credentials: 'same-origin' });
    } catch (error) {
      // Отмену запроса (уход со страницы, новый запрос того же ключа) слой данных обрабатывает сам
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new BffError(0, null, 'Нет связи с сервером');
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      try {
        return (await response.json()) as T;
      } catch {
        throw new BffError(0, null, 'Ответ сервера не разобран');
      }
    }
    const error = await toError(response);
    if (response.status === 401) deps.onUnauthorized();
    throw error;
  }

  return {
    get(path, options) {
      const { query, params, signal, background = false } = options ?? {};
      // Соответствие параметров пути проверено типом GetOptions на стороне вызова
      const url = buildBffUrl(path, params as Record<string, string | number> | undefined, query);
      return request(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...(background ? { [BACKGROUND_HEADER]: '1' } : {}) },
        signal,
      });
    },

    send(method, path, options) {
      const { params, body, signal } = options as {
        params?: Record<string, string | number>;
        body?: unknown;
        signal?: AbortSignal;
      };
      return request(buildBffUrl(path, params), {
        method: method.toUpperCase(),
        // Content-Type: application/json — слой защиты от CSRF (ADR 0016): BFF требует его у POST и PATCH даже
        // без тела, а HTML-форма с чужого сайта такой заголовок отправить не может. У DELETE тела нет вовсе
        headers: { accept: 'application/json', ...(method === 'delete' ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    },
  };
}

/** Клиент для компонентов. В тестах создаётся свой — с подставным fetch */
export const bff: BffClient = createBffClient({
  fetch: (input, init) => globalThis.fetch(input, init),
  onUnauthorized: () => window.location.assign(SESSION_EXPIRED_URL),
});
