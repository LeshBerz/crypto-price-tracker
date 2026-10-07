// Контроль C7 (ADR 0004, 0005): в рантайм apps/api попадают только библиотеки из ТЗ и модули node:*.
// Запуск: node scripts/check-deps.ts. Без зависимостей — только node:*.
import { builtinModules } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const RUNTIME_ALLOWLIST: ReadonlySet<string> = new Set(['express', 'axios', 'swagger-ui-express']);

export type Violation = { file: string; line: number; specifier: string; reason: string };

// import … from 'x' · import 'x' · export … from 'x' · import('x') · require('x')
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith('_')));

/** 'axios/lib/x' → 'axios', '@scope/pkg/x' → '@scope/pkg' */
export function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

export function checkSource(file: string, source: string, dependencies: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');
  lines.forEach((text, index) => {
    if (/^\s*(\/\/|\*)/.test(text)) return; // комментарии не импортируют
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[2] ?? '';
      const at = { file, line: index + 1, specifier };
      if (specifier.startsWith('./') || specifier.startsWith('../')) continue;
      if (specifier.startsWith('node:')) continue;
      if (BUILTINS.has(packageName(specifier))) {
        violations.push({ ...at, reason: `встроенный модуль без префикса: используйте 'node:${specifier}'` });
        continue;
      }
      const name = packageName(specifier);
      if (!RUNTIME_ALLOWLIST.has(name)) {
        violations.push({ ...at, reason: `'${name}' нет в allowlist ТЗ (${[...RUNTIME_ALLOWLIST].join(', ')})` });
      } else if (!dependencies.has(name)) {
        violations.push({ ...at, reason: `'${name}' не объявлен в dependencies apps/api (phantom dependency)` });
      }
    }
  });
  return violations;
}

export function checkManifest(dependencies: ReadonlySet<string>): string[] {
  return [...dependencies]
    .filter((name) => !RUNTIME_ALLOWLIST.has(name))
    .map((name) => `apps/api/package.json: '${name}' в dependencies вне allowlist ТЗ — перенесите в devDependencies`);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) yield path;
  }
}

function main(): void {
  const root = process.cwd();
  const apiDir = join(root, 'apps', 'api');
  const manifest = JSON.parse(readFileSync(join(apiDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = new Set(Object.keys(manifest.dependencies ?? {}));

  const problems = checkManifest(dependencies);
  let files = 0;
  for (const file of walk(join(apiDir, 'src'))) {
    files += 1;
    for (const v of checkSource(relative(root, file), readFileSync(file, 'utf8'), dependencies)) {
      problems.push(`${v.file}:${v.line}: ${v.specifier} — ${v.reason}`);
    }
  }

  if (problems.length > 0) {
    console.error(`check-deps: ${problems.length} нарушений C7\n${problems.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-deps: OK — ${files} файлов, dependencies: ${[...dependencies].join(', ') || '—'}`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();
