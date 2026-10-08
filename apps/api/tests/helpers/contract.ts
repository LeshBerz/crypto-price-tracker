// Jest-матчеры контракта (ADR 0008, 0009): каждый HTTP-тест заодно проверяет, что ответ соответствует openapi.yaml.
// Подключаются для всех тестов через setupFilesAfterEnv в jest.config.js.
import { openapiDocument } from '../../src/generated/openapi.ts';
import type { ProblemSlug } from '../../src/http/problem.ts';
import type { OperationId } from '../../src/http/router.ts';
import type { ValidationIssue } from '../../src/openapi/schema.ts';
import { checkResponse, compileSpec, type ResponseUnderTest } from '../../src/openapi/spec.ts';

export const spec = compileSpec(openapiDocument);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    // Сигнатура обязана совпадать с @types/jest, даже если T не используется
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
    interface Matchers<R, T = {}> {
      /** Статус совпадает, объявлен в операции, заголовки и тело проходят схемы спеки, есть X-Request-Id */
      toMatchContract(operationId: OperationId, status: number): R;
      /** Ответ роутера вне операций (404, 405): Problem по схеме, нужный type, requestId = X-Request-Id */
      toBeProblem(status: number, slug: ProblemSlug): R;
    }
  }
}

function describe(response: ResponseUnderTest): string {
  return `${response.status} ${String(response.headers['content-type'])}\n${response.text.slice(0, 800)}`;
}

function result(problems: string[], what: string, response: ResponseUnderTest): jest.CustomMatcherResult {
  const pass = problems.length === 0;
  return {
    pass,
    message: () =>
      pass
        ? `Ожидалось, что ответ НЕ соответствует ${what}`
        : `Ответ не соответствует ${what}:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\nОтвет: ${describe(response)}`,
  };
}

expect.extend({
  toMatchContract(response: ResponseUnderTest, operationId: OperationId, status: number) {
    const problems: string[] = [];
    if (response.status !== status) problems.push(`статус ${response.status}, а ожидался ${status}`);
    else problems.push(...checkResponse(spec.operation(operationId), response));
    if (response.headers['x-request-id'] === undefined) problems.push('нет заголовка X-Request-Id');
    return result(problems, `контракту ${operationId} → ${status}`, response);
  },

  toBeProblem(response: ResponseUnderTest, status: number, slug: ProblemSlug) {
    const problems: string[] = [];
    const body = response.body as { type?: unknown; status?: unknown; requestId?: unknown };
    if (response.status !== status) problems.push(`статус ${response.status}, а ожидался ${status}`);
    if (!String(response.headers['content-type']).startsWith('application/problem+json')) {
      problems.push('Content-Type не application/problem+json');
    }
    const issues: ValidationIssue[] = [];
    spec.componentSchema('Problem')(response.body, '', issues);
    problems.push(...issues.map((issue) => `${issue.path || '/'} ${issue.message}`));
    if (body.type !== `urn:cpt:problem:${slug}`) problems.push(`type ${String(body.type)}, а ожидался ${slug}`);
    if (body.status !== response.status) problems.push('поле status не совпадает со статусом ответа');
    if (body.requestId === undefined || body.requestId !== response.headers['x-request-id']) {
      problems.push('requestId в теле не совпадает с X-Request-Id');
    }
    return result(problems, `Problem ${status} ${slug}`, response);
  },
});
