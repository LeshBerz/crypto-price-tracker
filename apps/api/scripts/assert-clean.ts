// Проверка в CI: сгенерированные файлы закоммичены и совпадают с перегенерацией (ADR 0008).
// git status, а не git diff: diff не видит новых неотслеживаемых файлов.
import { execFileSync } from 'node:child_process';

const paths = process.argv.slice(2);
const status = execFileSync('git', ['status', '--porcelain', '--', ...paths], { encoding: 'utf8' }).trim();

if (status !== '') {
  console.error(`Сгенерированные файлы устарели — выполните npm run codegen и закоммитьте:\n${status}`);
  process.exit(1);
}
console.log(`codegen: актуально (${paths.join(', ')})`);
