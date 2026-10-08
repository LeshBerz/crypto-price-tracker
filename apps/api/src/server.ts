// Composition root ТЗ-редакции (ADR 0005, 0015 §5): конфиг → логгер → БД и миграции → приложение → listen.
// Здесь живут настоящие адаптеры; всё остальное получает их аргументами. Bootstrap ключей (B8), планировщик (B12)
// и graceful shutdown по SIGTERM/SIGINT (B14) добавятся сюда же.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createApp } from './app.ts';
import { SystemClock } from './common/clock.ts';
import { createJsonLogger } from './common/logger.ts';
import { ConfigError, loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { loadMigrations, migrate } from './db/migrations.ts';

function main(): void {
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

  const app = createApp({ db, schemaVersion: current, logger, clock });
  const server = app.listen(config.port, () => {
    logger.info('http server listening', { port: config.port, docs: `http://localhost:${config.port}/docs` });
  });
  server.on('error', (error) => {
    logger.error('http server failed', { error });
    process.exit(1);
  });
}

main();
