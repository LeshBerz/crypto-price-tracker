// Доказательство C8 («на каждый эндпоинт — позитивный и негативный тест»): сверка отчёта Jest с операциями спеки.
// Тест относится к операции, если один из его describe начинается с `[operationId]` или с `operationId `
// (табличный тест прав). ✅ в названии — позитивный кейс, ❌ — негативный. Считаются только прошедшие тесты.
// Чистые функции без I/O: их проверяет Jest, а запускает check-endpoint-coverage.ts.

export type SpecOperation = { operationId: string; method: string; path: string };

/** Нужная часть отчёта `jest --json` */
export type JestReport = {
  testResults: {
    name: string;
    assertionResults: { ancestorTitles: string[]; title: string; status: string }[];
  }[];
};

export type OperationCoverage = SpecOperation & {
  positive: CoveredTest[];
  negative: CoveredTest[];
};
export type CoveredTest = { file: string; title: string };

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** document — разобранный OpenAPI (generated/openapi.ts типизирован как unknown) */
export function operationsOf(document: unknown): SpecOperation[] {
  const { paths } = document as { paths: Record<string, Record<string, unknown>> };
  const operations: SpecOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const operation = item[method] as { operationId?: string } | undefined;
      if (operation?.operationId) operations.push({ operationId: operation.operationId, method, path });
    }
  }
  return operations;
}

/** Путь файла от каталога tests с прямыми слэшами: отчёт одинаков на Windows и Linux */
function relative(file: string): string {
  const normalized = file.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/tests/') + 1);
}

export function collectCoverage(operations: SpecOperation[], report: JestReport): OperationCoverage[] {
  const byId = new Map<string, OperationCoverage>(
    operations.map((op) => [op.operationId, { ...op, positive: [], negative: [] }]),
  );
  const files = [...report.testResults].sort((a, b) => relative(a.name).localeCompare(relative(b.name), 'en'));
  for (const file of files) {
    for (const test of file.assertionResults) {
      if (test.status !== 'passed') continue;
      const kind = test.title.startsWith('✅') ? 'positive' : test.title.startsWith('❌') ? 'negative' : null;
      if (kind === null) continue;
      for (const ancestor of test.ancestorTitles) {
        const id = /^\[?(\w+)\]?(\s|$)/.exec(ancestor)?.[1];
        const coverage = id === undefined ? undefined : byId.get(id);
        if (!coverage) continue;
        coverage[kind].push({ file: relative(file.name), title: test.title.slice(1).trim() });
        break;
      }
    }
  }
  return [...byId.values()];
}

/** Нарушения C8. Пустой список — у каждой операции есть и позитивный, и негативный тест */
export function coverageProblems(coverage: OperationCoverage[]): string[] {
  return coverage.flatMap((op) => [
    ...(op.positive.length === 0 ? [`${op.operationId}: нет позитивного теста (✅)`] : []),
    ...(op.negative.length === 0 ? [`${op.operationId}: нет негативного теста (❌)`] : []),
  ]);
}

const cell = (text: string) => text.replaceAll('|', '\\|');

export function renderMatrix(coverage: OperationCoverage[]): string {
  const positive = coverage.reduce((sum, op) => sum + op.positive.length, 0);
  const negative = coverage.reduce((sum, op) => sum + op.negative.length, 0);
  const lines = [
    '# Матрица тестов по эндпоинтам (C8)',
    '',
    '> Файл сгенерирован: `npm run test:matrix -w @cpt/api` (отчёт Jest × операции `openapi.yaml`). Руками не править.',
    '',
    `Операций в контракте — **${coverage.length}**, тестов на них — **${positive + negative}** (✅ ${positive}, ❌ ${negative}).`,
    'Требование C8: у каждой операции есть хотя бы один позитивный и один негативный тест. Проверка входит в `npm run check` и CI.',
    '',
    '| Операция | Метод и путь | ✅ | ❌ |',
    '|---|---|---|---|',
    ...coverage.map(
      (op) =>
        `| [\`${op.operationId}\`](#${op.operationId.toLowerCase()}) | \`${op.method.toUpperCase()} ${op.path}\` | ${op.positive.length} | ${op.negative.length} |`,
    ),
  ];
  for (const op of coverage) {
    lines.push(
      '',
      `## ${op.operationId}`,
      '',
      `\`${op.method.toUpperCase()} ${op.path}\``,
      '',
      '| | Тест | Файл |',
      '|---|---|---|',
    );
    for (const [mark, tests] of [
      ['✅', op.positive],
      ['❌', op.negative],
    ] as const) {
      for (const test of tests) lines.push(`| ${mark} | ${cell(test.title)} | \`${test.file}\` |`);
    }
  }
  return lines.join('\n') + '\n';
}
