// Проверка C8 и генерация docs/project/test-matrix.md. Запуск из apps/api после `npm run test:cov`
// (тот пишет отчёт coverage/jest-report.json): npm run test:matrix.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openapiDocument } from '../src/generated/openapi.ts';
import { collectCoverage, coverageProblems, operationsOf, renderMatrix, type JestReport } from './endpoint-coverage.ts';

const REPORT = join('coverage', 'jest-report.json');
const MATRIX = join('..', '..', 'docs', 'project', 'test-matrix.md');

let report: JestReport;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8')) as JestReport;
} catch {
  console.error(`Нет отчёта ${REPORT}: сначала выполните npm run test:cov -w @cpt/api`);
  process.exit(1);
}

const coverage = collectCoverage(operationsOf(openapiDocument), report);
const problems = coverageProblems(coverage);
if (problems.length > 0) {
  console.error(`C8 нарушено:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  process.exit(1);
}
writeFileSync(MATRIX, renderMatrix(coverage));
console.log(`C8: ${coverage.length} операций, у каждой есть ✅ и ❌ → ${MATRIX}`);
