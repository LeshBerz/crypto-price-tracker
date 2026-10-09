// Сборка HTTP-приложения из явно переданных зависимостей (ADR 0015: composition root без DI-контейнера).
// Тесты вызывают createApp с SQLite :memory:, FakeClock и фейковым Authenticator; server.ts — с настоящими.
import express, { type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { Clock } from './common/clock.ts';
import type { Logger } from './common/logger.ts';
import type { Database } from './db/database.ts';
import { openapiDocument } from './generated/openapi.ts';
import { healthHandlers, staticLifecycle, type Lifecycle } from './health.ts';
import type { Authenticator } from './http/auth.ts';
import { errorHandler, notFound } from './http/errors.ts';
import { HttpProblem } from './http/problem.ts';
import { requestContext } from './http/request-context.ts';
import { mountFromSpec, type Handlers, type OperationId } from './http/router.ts';
import { compileSpec } from './openapi/spec.ts';

export type AppDeps = {
  db: Database;
  /** Версия последней известной миграции — для readiness */
  schemaVersion: number;
  logger: Logger;
  clock: Clock;
  authenticator: Authenticator;
  lifecycle?: Lifecycle;
  generateRequestId?: () => string;
};

/**
 * Операции, хендлеры которых появятся в следующих задачах (B8–B13). Явный список вместо Partial<Handlers>:
 * тип Handlers по-прежнему требует хендлер на каждую операцию, а заглушки видно поиском.
 */
const PENDING = [
  'listCryptocurrencies',
  'createCryptocurrency',
  'getCryptocurrency',
  'updateCryptocurrency',
  'deleteCryptocurrency',
  'listLatestPrices',
  'listSparklines',
  'listPriceHistory',
  'getPriceAggregates',
  'listSyncRuns',
  'triggerSyncRun',
  'getSyncRun',
  'getCmcStatus',
  'streamEvents',
] as const satisfies readonly OperationId[];

function pending(operationId: OperationId) {
  return () => {
    throw new HttpProblem(500, 'internal-error', { detail: `Operation ${operationId} is not implemented yet` });
  };
}

export function createApp(deps: AppDeps): Express {
  // Компиляция спеки при старте: неподдерживаемое ключевое слово — исключение здесь, а не на запросе (ADR 0008)
  const spec = compileSpec(openapiDocument);
  const lifecycle = deps.lifecycle ?? staticLifecycle;

  // satisfies: операция, которой нет ни в PENDING, ни среди реализованных, — ошибка компиляции
  const handlers = {
    ...(Object.fromEntries(PENDING.map((id) => [id, pending(id)])) as Record<(typeof PENDING)[number], () => never>),
    ...healthHandlers({ db: deps.db, schemaVersion: deps.schemaVersion, lifecycle }),
  } satisfies Handlers;

  const app = express();
  app.disable('x-powered-by');
  // Явно: простой парсер query (node:querystring) — без вложенных объектов вида a[b]=c
  app.set('query parser', 'simple');

  app.use(requestContext({ logger: deps.logger, clock: deps.clock, generateId: deps.generateRequestId }));

  // Документация вне спеки и публична (F8, ADR 0008). Scarf-телеметрия выключена в package.json (ADR 0004)
  app.get('/openapi.json', (_req, res) => {
    res.json(openapiDocument);
  });
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapiDocument as swaggerUi.JsonObject, { customSiteTitle: 'Crypto Price Tracker API' }),
  );

  app.use(mountFromSpec({ spec, handlers, authenticator: deps.authenticator }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
