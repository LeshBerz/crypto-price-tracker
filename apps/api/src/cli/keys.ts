// Точка входа CLI ключей: npm run keys:create -- --name web-operator --role operator (ADR 0002).
// Открывает ту же БД, что и сервер, и применяет миграции — команда работает и на пустой БД до первого старта.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SystemClock } from '../common/clock.ts';
import { databasePathFrom } from '../config.ts';
import { openDatabase } from '../db/database.ts';
import { loadMigrations, migrate } from '../db/migrations.ts';
import { SqliteUnitOfWork } from '../db/unit-of-work.ts';
import { runKeysCommand } from './keys-command.ts';

const clock = new SystemClock();
const path = databasePathFrom(process.env);
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const db = openDatabase(path);
// Путь от рабочего каталога, как в server.ts: import.meta запрещён (ADR 0004)
migrate(db, loadMigrations(join(process.cwd(), 'migrations')), () => clock.now());

const code = await runKeysCommand(process.argv.slice(2), {
  uow: new SqliteUnitOfWork(db),
  clock,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
});
db.close();
process.exitCode = code;
