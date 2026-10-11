// Точка входа CLI: npm run rollups:rebuild (ADR 0007). Пересобирает часовые свёртки из price_history —
// на случай, если свёртка повреждена или изменилась её формула. Сервер на время пересборки лучше остановить:
// команда держит одну пишущую транзакцию на всю работу.
import { join } from 'node:path';
import { SystemClock } from '../common/clock.ts';
import { databasePathFrom } from '../config.ts';
import { openDatabase } from '../db/database.ts';
import { loadMigrations, migrate } from '../db/migrations.ts';
import { SqliteUnitOfWork } from '../db/unit-of-work.ts';

const clock = new SystemClock();
const db = openDatabase(databasePathFrom(process.env));
// Путь от рабочего каталога, как в server.ts: import.meta запрещён (ADR 0004)
migrate(db, loadMigrations(join(process.cwd(), 'migrations')), () => clock.now());

const startedAt = clock.now();
const rebuilt = await new SqliteUnitOfWork(db).run((repos) => repos.prices.rebuildRollups());
db.close();
process.stdout.write(`Свёртки пересобраны: ${rebuilt} (монета × час), ${clock.now() - startedAt} мс\n`);
