// Тесты корневых скриптов — на встроенном node:test: скрипты не входят ни в один workspace,
// и тянуть ради них Jest в корень незачем. Запуск: npm run test:scripts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkManifest, checkSource, packageName } from './check-deps.ts';

const deps = new Set(['express', 'axios', 'swagger-ui-express']);
const reasons = (source: string, d: ReadonlySet<string> = deps) =>
  checkSource('x.ts', source, d).map((v) => `${v.specifier}: ${v.reason}`);

describe('check-deps', () => {
  it('✅ пропускает относительные импорты, node:* и пакеты из allowlist', () => {
    const source = [
      "import { a } from './a.ts';",
      "import type { B } from '../b.ts';",
      "import { createHash } from 'node:crypto';",
      "import express, { type Request } from 'express';",
      "export { x } from './x.ts';",
      "const m = await import('axios');",
      "import 'swagger-ui-express';",
    ].join('\n');
    assert.deepEqual(reasons(source), []);
  });

  it('❌ ловит пакет вне allowlist — в том числе type-only и динамический импорт', () => {
    const source = [
      "import { z } from 'zod';",
      "import type { Redis } from 'ioredis';",
      "const pg = await import('pg');",
      "const x = require('lodash/fp');",
    ].join('\n');
    assert.deepEqual(
      reasons(source).map((r) => r.split(':')[0]),
      ['zod', 'ioredis', 'pg', 'lodash/fp'],
    );
  });

  it('❌ требует префикс node: у встроенных модулей', () => {
    assert.match(reasons("import fs from 'fs';")[0] ?? '', /node:fs/);
  });

  it('❌ ловит phantom dependency: пакет из allowlist, но не объявлен в dependencies', () => {
    assert.match(reasons("import axios from 'axios';", new Set(['express']))[0] ?? '', /phantom/);
  });

  it('пропускает закомментированные импорты', () => {
    assert.deepEqual(reasons("// import { z } from 'zod';"), []);
  });

  it('❌ проверяет dependencies в package.json', () => {
    assert.deepEqual(checkManifest(new Set(['express'])), []);
    assert.equal(checkManifest(new Set(['express', 'dotenv'])).length, 1);
  });

  it('выделяет имя пакета из глубокого и scoped-импорта', () => {
    assert.equal(packageName('axios/lib/core'), 'axios');
    assert.equal(packageName('@cpt/api/src/x'), '@cpt/api');
  });
});
