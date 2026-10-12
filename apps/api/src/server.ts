// Composition root ТЗ-редакции (ADR 0005, 0015 §5): конфиг → логгер → БД и миграции → приложение → listen.
// Здесь живут настоящие адаптеры; всё остальное получает их аргументами.
// Остановка по SIGTERM/SIGINT — ShutdownCoordinator (shutdown.ts).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createApp } from './app.ts';
import { ApiKeyAuthenticator } from './auth/api-key-authenticator.ts';
import { bootstrapApiKeys } from './auth/bootstrap.ts';
import { SystemClock } from './common/clock.ts';
import { createJsonLogger } from './common/logger.ts';
import { ConfigError, loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { loadMigrations, migrate } from './db/migrations.ts';
import { SqliteUnitOfWork } from './db/unit-of-work.ts';
import { InProcessEventBus } from './events/event-bus.ts';
import { SseHub } from './events/sse-hub.ts';
import { CmcMarketDataProvider } from './market-data/cmc-provider.ts';
import { SyncScheduler } from './sync/scheduler.ts';
import { ShutdownCoordinator } from './shutdown.ts';
import { SyncService } from './sync/sync-service.ts';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    // Логгера ещё нет (уровень берётся из конфига). Сообщение ConfigError не содержит значений переменных
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const clock = new SystemClock();
  const logger = createJsonLogger({ level: config.logLevel, clock });

  if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
  const db = openDatabase(config.databasePath);
  // Путь от рабочего каталога: import.meta в src запрещён (ADR 0004). npm -w и Docker запускают из apps/api
  const migrations = loadMigrations(join(process.cwd(), 'migrations'));
  const { applied, current } = migrate(db, migrations, () => clock.now());
  logger.info('database ready', { path: config.databasePath, schemaVersion: current, applied });

  const uow = new SqliteUnitOfWork(db);
  await bootstrapApiKeys({ keys: config.bootstrapKeys, uow, clock, logger });
  const authenticator = new ApiKeyAuthenticator({ uow, clock });

  const marketData = new CmcMarketDataProvider({ ...config.cmc, clock });
  const events = new InProcessEventBus(logger);

  const sync = new SyncService({ uow, marketData, events, clock, logger });
  const sse = new SseHub({ events, clock, logger });
  const scheduler = new SyncScheduler({ sync, uow, clock, logger, intervalMs: config.syncIntervalMs });

  // Координатору нужен http-сервер, а приложению — флаг остановки: связываем через позднюю ссылку
  let shutdown: ShutdownCoordinator | null = null;
  const app = createApp({
    db,
    schemaVersion: current,
    logger,
    clock,
    authenticator,
    uow,
    marketData,
    events,
    sync,
    sse,
    syncIntervalMs: config.syncIntervalMs,
    lifecycle: {
      isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
      schedulerState: () => scheduler.state,
      nextRunAt: () => scheduler.nextRunAt,
    },
  });
  const server = app.listen(config.port, () => {
    logger.info('http server listening', { port: config.port, docs: `http://localhost:${config.port}/docs` });
    // Планировщик — после listen (ADR 0015 §5): сначала сервис готов отвечать, потом начинает фоновую работу
    scheduler.start().catch((error: unknown) => {
      logger.error('scheduler failed to start', { error });
      process.exit(1);
    });
  });
  shutdown = new ShutdownCoordinator({
    server,
    scheduler,
    sync,
    sse,
    db,
    clock,
    logger,
    exit: (code) => process.exit(code),
  });
  shutdown.listen(process);
  server.on('error', (error) => {
    logger.error('http server failed', { error });
    process.exit(1);
  });
}

await main();
