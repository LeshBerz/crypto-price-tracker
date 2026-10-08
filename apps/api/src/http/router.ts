// Роутер из спеки (ADR 0008): обходит операции openapi.yaml и для каждой монтирует
// auth (x-required-scopes) → Content-Type → разбор JSON → валидацию → хендлер по operationId.
// Эндпоинта «мимо контракта» нет по построению. Аналог в Nest — @Controller + @Get + @UseGuards + ValidationPipe,
// только описанные одним YAML, а не декораторами в коде.
import express, { type Request, type RequestHandler, type Response, type Router } from 'express';
import type { operations } from '../generated/api-types.ts';
import type { Logger } from '../common/logger.ts';
import type { CompiledOperation, CompiledSpec, RequestInput } from '../openapi/spec.ts';
import { requireScopes, type Authenticator, type Principal } from './auth.ts';
import { HttpProblem, validationProblem } from './problem.ts';

export type OperationId = keyof operations;

// ---- Типы хендлеров выводятся из api-types.ts: контракт проверяет компилятор ----

type ParamsOf<Op, In extends 'path' | 'query'> = Op extends { parameters: infer P }
  ? In extends keyof P
    ? [NonNullable<P[In]>] extends [never]
      ? Record<string, never>
      : NonNullable<P[In]>
    : Record<string, never>
  : never;
type BodyOf<Op> = Op extends { requestBody?: infer RB }
  ? NonNullable<RB> extends { content: { 'application/json': infer B } }
    ? B
    : undefined
  : undefined;
type ResponsesOf<Op> = Op extends { responses: infer R } ? R : never;
type JsonOf<R> = R extends { content: { 'application/json': infer B } } ? B : undefined;
/** Статусы, которые хендлер возвращает сам: 2xx и ответы с телом application/json (503 у readiness) */
type ReplyStatus<Op> = {
  [S in keyof ResponsesOf<Op>]: S extends 200 | 201 | 202 | 204
    ? S
    : [JsonOf<ResponsesOf<Op>[S]>] extends [undefined]
      ? never
      : S;
}[keyof ResponsesOf<Op>];
// body?: never — явно: возвращаемое значение функции не проверяется на лишние поля, и { status: 204, body }
// без этого компилировалось бы
type ReplyFor<S, R> = [JsonOf<R>] extends [undefined]
  ? { status: S; body?: never; headers?: Record<string, string> }
  : { status: S; body: JsonOf<R>; headers?: Record<string, string> };

/**
 * Что может вернуть хендлер: статус из контракта и тело ровно по его схеме — иначе ошибка компиляции.
 * Ошибки (application/problem+json) не возвращаются, а бросаются: throw new HttpProblem(...)
 */
export type Reply<Op> = { [S in ReplyStatus<Op>]: ReplyFor<S, ResponsesOf<Op>[S]> }[ReplyStatus<Op>];

/** Хендлер сам записал ответ в res (SSE-поток) — роутеру отвечать не нужно */
export const RESPONDED = Symbol('responded');

export type HandlerContext<Op> = {
  input: { path: ParamsOf<Op, 'path'>; query: ParamsOf<Op, 'query'>; body: BodyOf<Op> };
  /** null у публичных операций */
  principal: Principal | null;
  requestId: string;
  log: Logger;
  req: Request;
  res: Response;
};
export type Handler<Op> = (
  ctx: HandlerContext<Op>,
) => Reply<Op> | typeof RESPONDED | Promise<Reply<Op> | typeof RESPONDED>;

/** Хендлер на каждую операцию спеки: пропущенная операция — ошибка компиляции */
export type Handlers = { [K in OperationId]: Handler<operations[K]> };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      input: RequestInput;
    }
  }
}

export type SpecRouterOptions = {
  spec: CompiledSpec;
  handlers: Handlers;
  authenticator: Authenticator;
};

export const BODY_LIMIT = '16kb';

export function mountFromSpec({ spec, handlers, authenticator }: SpecRouterOptions): Router {
  const router = express.Router();
  // inflate: false — сжатое тело не распаковываем (защита от zip-бомб), такой запрос получит 415
  const json = express.json({ limit: BODY_LIMIT, inflate: false });

  const byPath = new Map<string, CompiledOperation[]>();
  for (const op of spec.operations) {
    const handler: unknown = (handlers as Record<string, unknown>)[op.operationId];
    // Типы это уже гарантируют; проверка на случай, если хендлеры собраны динамически
    if (typeof handler !== 'function') throw new Error(`Нет хендлера для операции ${op.operationId}`);
    byPath.set(op.expressPath, [...(byPath.get(op.expressPath) ?? []), op]);
  }

  for (const [expressPath, ops] of byPath) {
    const route = router.route(expressPath);
    for (const op of ops) {
      const chain: RequestHandler[] = [];
      if (!op.isPublic) chain.push(requireScopes(authenticator, op.requiredScopes));
      if (op.requestBody) chain.push(requireJson, json);
      chain.push(validate(op), invoke(op, handlers[op.operationId as OperationId] as Handler<unknown>));
      route[op.method](...chain);
    }
    // Путь известен, метод — нет: 405 + Allow (RFC 9110 §15.5.6, поправка R2 к ADR 0014)
    const methods = ops.map((op) => op.method.toUpperCase());
    const allow = [...methods, ...(methods.includes('GET') ? ['HEAD'] : [])].join(', ');
    route.all((req) => {
      throw new HttpProblem(405, 'method-not-allowed', {
        detail: `Method ${req.method} is not allowed here`,
        headers: { Allow: allow },
      });
    });
  }
  return router;
}

/**
 * Есть ли у запроса тело. type-is считает телом и Content-Length: 0, а его шлёт любой POST без данных:
 * тогда POST /sync-runs без тела получил бы 400 «тело не ожидается».
 */
export function hasBody(req: Request): boolean {
  const length = req.get('content-length');
  if (length !== undefined) return Number(length) > 0;
  return req.get('transfer-encoding') !== undefined;
}

const requireJson: RequestHandler = (req, _res, next) => {
  if (hasBody(req) && !req.is('application/json')) {
    throw new HttpProblem(415, 'unsupported-media-type', { detail: 'Request body must be application/json' });
  }
  next();
};

function validate(op: CompiledOperation): RequestHandler {
  return (req, res, next) => {
    const result = op.parseRequest({
      params: req.params,
      // Express 5: req.query — геттер, перезаписать нельзя, поэтому результат кладём в res.locals (ADR 0008)
      query: req.query as Record<string, unknown>,
      body: req.body,
      hasBody: hasBody(req),
    });
    if (!result.ok) throw validationProblem(result.issues);
    res.locals.input = result.input;
    next();
  };
}

function invoke(op: CompiledOperation, handler: Handler<unknown>): RequestHandler {
  return async (req, res) => {
    const log = res.locals.log.child({ operationId: op.operationId });
    const reply = (await handler({
      input: res.locals.input as never,
      principal: res.locals.principal ?? null,
      requestId: res.locals.requestId,
      log,
      req,
      res,
    })) as { status: number; body?: unknown; headers?: Record<string, string> } | typeof RESPONDED;
    if (reply === RESPONDED) return;
    for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
    if ('body' in reply) res.status(reply.status).json(reply.body);
    else res.status(reply.status).end();
  };
}
