// Проверка самой проверки C8: без этого «зелёный» check-endpoint-coverage ничего бы не доказывал.
import {
  collectCoverage,
  coverageProblems,
  operationsOf,
  renderMatrix,
  type JestReport,
} from '../../scripts/endpoint-coverage.ts';
import { openapiDocument } from '../../src/generated/openapi.ts';

const LIST = { operationId: 'listThings', method: 'get', path: '/things' };
const CREATE = { operationId: 'createThing', method: 'post', path: '/things' };
const OPERATIONS = [LIST, CREATE];

const report = (...files: JestReport['testResults']): JestReport => ({ testResults: files });
const test = (ancestors: string[], title: string, status = 'passed') => ({ ancestorTitles: ancestors, title, status });

describe('operationsOf', () => {
  it('читает операции из документа OpenAPI, не-методы (parameters) пропускает', () => {
    const document = {
      paths: {
        '/things': { parameters: [], get: { operationId: 'listThings' }, post: { operationId: 'createThing' } },
      },
    };
    expect(operationsOf(document)).toEqual(OPERATIONS);
  });

  it('в настоящем контракте 16 операций', () => {
    expect(operationsOf(openapiDocument)).toHaveLength(16);
  });
});

describe('collectCoverage', () => {
  it('относит тест к операции по [operationId] и по строке табличного теста; считает только прошедшие', () => {
    const coverage = collectCoverage(
      OPERATIONS,
      report(
        {
          name: 'C:\\repo\\apps\\api\\tests\\things\\things.test.ts',
          assertionResults: [
            test(['[listThings] GET /things'], '✅ 200 список'),
            test(['[listThings] GET /things'], '❌ 400 плохой limit', 'failed'),
            test(['[listThings] GET /things'], 'без метки — не считается'),
            test(['[unknownOperation] GET /nope'], '✅ чужая операция'),
            test(['сервис'], '✅ не про эндпоинт'),
          ],
        },
        {
          name: '/repo/apps/api/tests/http/auth-matrix.test.ts',
          assertionResults: [test(['матрица прав', 'listThings get /things'], '❌ без ключа → 401')],
        },
      ),
    );
    expect(coverage).toEqual([
      {
        ...LIST,
        positive: [{ file: 'tests/things/things.test.ts', title: '200 список' }],
        negative: [{ file: 'tests/http/auth-matrix.test.ts', title: 'без ключа → 401' }],
      },
      { ...CREATE, positive: [], negative: [] },
    ]);
  });

  it('порядок файлов не зависит от порядка в отчёте', () => {
    const a = { name: '/r/tests/a.test.ts', assertionResults: [test(['[listThings]'], '✅ a')] };
    const b = { name: '/r/tests/b.test.ts', assertionResults: [test(['[listThings]'], '✅ b')] };
    expect(collectCoverage(OPERATIONS, report(b, a))).toEqual(collectCoverage(OPERATIONS, report(a, b)));
  });
});

describe('coverageProblems и renderMatrix', () => {
  const covered = { file: 'tests/x.test.ts', title: 'кейс | с чертой' };

  it('операция без ✅ или без ❌ — нарушение C8', () => {
    expect(
      coverageProblems([
        { ...LIST, positive: [covered], negative: [covered] },
        { ...CREATE, positive: [], negative: [] },
      ]),
    ).toEqual(['createThing: нет позитивного теста (✅)', 'createThing: нет негативного теста (❌)']);
  });

  it('таблица: счётчики, якоря и экранирование черты', () => {
    const markdown = renderMatrix([{ ...LIST, positive: [covered], negative: [covered, covered] }]);
    expect(markdown).toContain('Операций в контракте — **1**, тестов на них — **3** (✅ 1, ❌ 2).');
    expect(markdown).toContain('| [`listThings`](#listthings) | `GET /things` | 1 | 2 |');
    expect(markdown).toContain('| ✅ | кейс \\| с чертой | `tests/x.test.ts` |');
    expect(markdown.endsWith('\n')).toBe(true);
  });
});
