// Ошибки HTTP в формате RFC 9457 Problem Details (ADR 0008, 0014). Тип — стабильный URN из enum спеки:
// клиент завязывается на type, а не на текст сообщения.
import type { Response } from 'express';
import type { components } from '../generated/api-types.ts';

export type ProblemBody = components['schemas']['Problem'];
/** Slug берётся прямо из enum контракта: опечатка в slug — ошибка компиляции */
export type ProblemSlug = ProblemBody['type'] extends `urn:cpt:problem:${infer Slug}` ? Slug : never;
export type ProblemIssue = NonNullable<ProblemBody['errors']>[number];

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

const TITLES: Record<ProblemSlug, string> = {
  'validation-error': 'Validation failed',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  'not-found': 'Not Found',
  'method-not-allowed': 'Method Not Allowed',
  'already-tracked': 'Cryptocurrency is already tracked',
  'sync-already-running': 'Sync is already running',
  'payload-too-large': 'Payload Too Large',
  'unsupported-media-type': 'Unsupported Media Type',
  'unknown-symbol': 'Unknown symbol',
  'watchlist-limit-reached': 'Watchlist limit reached',
  'upstream-unavailable': 'Upstream unavailable',
  'internal-error': 'Internal Server Error',
};

export type ProblemOptions = {
  detail?: string;
  errors?: ProblemIssue[];
  conflictingId?: number;
  /** Заголовки ответа: Allow, WWW-Authenticate, Retry-After */
  headers?: Record<string, string>;
  cause?: unknown;
};

/** Бросается из middleware и хендлеров; error-middleware превращает её в ответ */
export class HttpProblem extends Error {
  override name = 'HttpProblem';
  readonly status: number;
  readonly slug: ProblemSlug;
  readonly options: ProblemOptions;

  constructor(status: number, slug: ProblemSlug, options: ProblemOptions = {}) {
    super(options.detail ?? TITLES[slug], { cause: options.cause });
    this.status = status;
    this.slug = slug;
    this.options = options;
  }
}

export function validationProblem(errors: ProblemIssue[]): HttpProblem {
  const fields = errors.length === 1 ? 'field' : 'fields';
  return new HttpProblem(400, 'validation-error', { detail: `Request has ${errors.length} invalid ${fields}`, errors });
}

export function sendProblem(res: Response, problem: HttpProblem, instance: string): void {
  const { detail, errors, conflictingId, headers } = problem.options;
  const body: ProblemBody = {
    type: `urn:cpt:problem:${problem.slug}` as ProblemBody['type'],
    title: TITLES[problem.slug],
    status: problem.status,
    ...(detail !== undefined && { detail }),
    instance,
    requestId: res.locals.requestId,
    ...(errors !== undefined && { errors }),
    ...(conflictingId !== undefined && { conflictingId }),
  };
  for (const [name, value] of Object.entries(headers ?? {})) res.setHeader(name, value);
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
}
