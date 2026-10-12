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

  constructor(status: number, problem: Problem | null, message?: string) {
    super(message ?? problem?.title ?? `HTTP ${status}`);
    this.status = status;
    this.problem = problem;
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

async function readProblem(response: Response): Promise<Problem | null> {
  if (!response.headers.get('content-type')?.includes('json')) return null;
  try {
    const body: unknown = await response.json();
    const isProblem = typeof body === 'object' && body !== null && typeof (body as Problem).type === 'string';
    return isProblem ? (body as Problem) : null;
  } catch {
    return null;
  }
}

export type BffClientDeps = {
  fetch: typeof globalThis.fetch;
  /** Сессии нет или она истекла: по умолчанию — переход на страницу входа */
  onUnauthorized: () => void;
};

export type BffClient = {
  get<P extends GetPath>(path: P, options?: GetOptions<P>): Promise<GetResponse<P>>;
};

export function createBffClient(deps: BffClientDeps): BffClient {
  return {
    async get(path, options) {
      const { query, params, signal, background = false } = options ?? {};
      // Соответствие параметров пути проверено типом GetOptions на стороне вызова
      const url = buildBffUrl(path, params as Record<string, string | number> | undefined, query);
      let response: Response;
      try {
        response = await deps.fetch(url, {
          method: 'GET',
          headers: { accept: 'application/json', ...(background ? { [BACKGROUND_HEADER]: '1' } : {}) },
          credentials: 'same-origin',
          signal,
        });
      } catch (error) {
        // Отмену запроса (уход со страницы, новый запрос того же ключа) слой данных обрабатывает сам
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new BffError(0, null, 'Нет связи с сервером');
      }

      if (response.ok) {
        try {
          return (await response.json()) as GetResponse<typeof path>;
        } catch {
          throw new BffError(0, null, 'Ответ сервера не разобран');
        }
      }
      const problem = await readProblem(response);
      if (response.status === 401) deps.onUnauthorized();
      throw new BffError(response.status, problem);
    },
  };
}

/** Клиент для компонентов. В тестах создаётся свой — с подставным fetch */
export const bff: BffClient = createBffClient({
  fetch: (input, init) => globalThis.fetch(input, init),
  onUnauthorized: () => window.location.assign(SESSION_EXPIRED_URL),
});
