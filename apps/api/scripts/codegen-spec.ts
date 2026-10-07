// Превращает собранную спеку (openapi/.bundle/openapi.json) в TS-модуль src/generated/openapi.ts.
// Почему модуль, а не чтение JSON с диска: путь к файлу пришлось бы вычислять через import.meta,
// а он не работает в Jest (CommonJS, ADR 0004). Модуль одинаково грузится в node, tsc и Jest.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const bundle = JSON.parse(readFileSync('openapi/.bundle/openapi.json', 'utf8')) as unknown;

const source = `// Сгенерировано scripts/codegen-spec.ts из openapi/openapi.yaml — не редактировать руками.
// Тип unknown намеренно: структуру проверяет компилятор спеки при старте (ADR 0008, fail-fast).
export const openapiDocument: unknown = ${JSON.stringify(bundle, null, 2)};
`;

mkdirSync('src/generated', { recursive: true });
writeFileSync('src/generated/openapi.ts', source);
console.log('codegen: src/generated/openapi.ts');
