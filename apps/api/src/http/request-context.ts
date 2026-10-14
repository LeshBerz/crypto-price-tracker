// Первый middleware каждого запроса: X-Request-Id, логгер запроса и access-лог (ADR 0014).
// Аналог в Nest — глобальный interceptor/middleware с ClsService; здесь хватает res.locals.
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Clock } from '../common/clock.ts';
import type { Logger } from '../common/logger.ts';

export const REQUEST_ID_HEADER = 'X-Request-Id';
/**
 * Входящий id переиспользуем, только если он безопасен: ≤ 64 символа (контракт) и без пробелов,
 * переводов строк и кавычек. Иначе клиент мог бы подделывать строки логов (log injection).
 */
export const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

declare global {
  // Типизация res.locals для всего приложения (Express 5 читает Express.Locals)
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      requestId: string;
      log: Logger;
    }
  }
}

export type RequestContextOptions = {
  logger: Logger;
  clock: Clock;
  generateId?: () => string;
};

export function requestContext({ logger, clock, generateId = randomUUID }: RequestContextOptions): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    const requestId = incoming !== undefined && VALID_REQUEST_ID.test(incoming) ? incoming : generateId();
    const startedAt = clock.now();

    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.locals.requestId = requestId;
    res.locals.log = logger.child({ requestId });

    // 'close' приходит всегда: и после полного ответа, и при обрыве соединения клиентом
    res.on('close', () => {
      const fields = {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: clock.now() - startedAt,
      };
      if (res.writableFinished) res.locals.log.info('request completed', fields);
      else res.locals.log.warn('request aborted by client', fields);
    });
    next();
  };
}
