// Последний рубеж: любая ошибка превращается в Problem Details (RFC 9457), а не в HTML-страницу Express.
// Аналог в Nest — глобальный ExceptionFilter.
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { BODY_LIMIT } from './router.ts';
import { HttpProblem, sendProblem, validationProblem } from './problem.ts';

/** Неизвестный путь → 404 not-found (поправка R2 к ADR 0014) */
export const notFound: RequestHandler = (req) => {
  throw new HttpProblem(404, 'not-found', { detail: `No route for ${req.method} ${pathOf(req.originalUrl)}` });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const problem = toProblem(error);
  if (problem.status >= 500) {
    res.locals.log.error('request failed', { error, status: problem.status });
  }
  if (res.headersSent) {
    // Ответ уже пошёл (например, SSE): дописать Problem нельзя — рвём соединение, клиент увидит обрыв
    res.destroy();
    return;
  }
  sendProblem(res, problem, pathOf(req.originalUrl));
};

type BodyParserError = { type: string; status: number };

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    error instanceof Error &&
    typeof (error as Partial<BodyParserError>).type === 'string' &&
    typeof (error as Partial<BodyParserError>).status === 'number'
  );
}

function toProblem(error: unknown): HttpProblem {
  if (error instanceof HttpProblem) return error;
  if (isBodyParserError(error)) {
    switch (error.type) {
      case 'entity.too.large':
        return new HttpProblem(413, 'payload-too-large', { detail: `Request body exceeds ${BODY_LIMIT}` });
      case 'entity.parse.failed':
        return validationProblem([{ path: '/body', message: 'must be valid JSON' }]);
      case 'encoding.unsupported':
      case 'charset.unsupported':
        return new HttpProblem(415, 'unsupported-media-type', {
          detail: 'Request body must be uncompressed UTF-8 application/json',
        });
    }
    // Прочие ошибки чтения тела 4xx (обрыв, неверная длина) — проблема запроса, а не сервера
    if (error.status < 500) return validationProblem([{ path: '/body', message: 'could not be read' }]);
  }
  // Детали — только в лог по requestId: стек и текст ошибки могут раскрыть внутренности (C4)
  return new HttpProblem(500, 'internal-error', { detail: 'Unexpected error. See logs by requestId', cause: error });
}

function pathOf(url: string): string {
  return url.split('?')[0] as string;
}
