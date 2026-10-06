# 0004. Трактовка C7 и инструменты разработки

- **Статус:** Accepted (06.10.2026)
- **Дата:** 06.10.2026
- **Вопрос брифа:** Q7
- **Требования:** C7, стек ТЗ, бриф §4 (lint, typecheck, conventional commits, git hooks)
- **Связано:** [0003 — Node 24 и `node:sqlite`](0003-sqlite-driver-and-node-version.md)

## Контекст

C7: «Можно использовать только указанные библиотеки и стандартные возможности Node.js». В стеке названы Node.js, Express, TypeScript, SQLite, Jest + Supertest, Swagger (OpenAPI 3.0), axios, Git, Docker.

Проблема в том, что формулировка не различает **код приложения** и **инструменты разработки**. Если читать её максимально строго, нельзя даже `@types/express`, хотя TypeScript без него с Express не работает. А бриф требует lint, typecheck и git hooks.

Что мы проверили руками (Node 24.21, 06.10.2026, прототип в scratchpad):

| Проверка | Результат |
|---|---|
| `node src/server.ts` | работает **нативно**, без tsx/ts-node и без предупреждений |
| `enum` в `.ts` | Node отклоняет: поддерживается только «стираемый» синтаксис (type stripping) |
| `process.loadEnvFile('.env')` | работает, dotenv не нужен |
| `tsc --noEmit` + `tsc -p tsconfig.build.json` → `node dist/server.js` | работает, импорты `./x.ts` переписываются в `./x.js` |
| Jest 30 + ts-jest 29 + Supertest + Express 5 + `node:sqlite` | тест проходит. Ts-jest ловит ошибки типов в тестах (TS2322) |
| TypeScript `latest` = **7.0.2** | ⚠️ ts-jest требует `typescript <7`, typescript-eslint — `<6.1.0` |
| TypeScript 6.0.3 | typecheck и Jest проходят |

## Варианты трактовки

1. **Буквальная.** Только пакеты из списка, в том числе в `devDependencies`. Без `@types/*`, ESLint, ts-jest. Тесты гоняем по скомпилированному JS.
2. **Runtime vs tooling.** C7 ограничивает то, что **исполняется в приложении** (`dependencies`, импорты из `src/`). Инструменты сборки, проверки и тестирования (`devDependencies`) не попадают в рантайм и не меняют поведение сервиса, поэтому допустимы. Правило проверяется автоматически.
3. **Свободная.** Любые пакеты, если их можно оправдать.

## Сравнение

| Критерий | 1. Буквальная | 2. Runtime vs tooling | 3. Свободная |
|---|---|---|---|
| Соответствие букве C7 в рантайме | ✅ | ✅ | ❌ |
| Типобезопасность (`@types/*`) | ❌ Express без типов, `any` повсюду | ✅ | ✅ |
| Lint, format, git hooks (требование брифа) | ❌ | ✅ | ✅ |
| Тесты на TypeScript | 🟡 только через предварительную сборку, медленно и неудобно | ✅ ts-jest | ✅ |
| Защищаемость на интервью | 🟡 «формально, но непрактично» | ✅ «C7 — про приложение, а не про верстак, и я это автоматически проверяю» | ❌ «не прочитал ограничения» |
| Индустриальная норма | — | ✅ ровно так делит npm: `dependencies` против `devDependencies` | — |

## Решение (рекомендация)

**Вариант 2. Правило:** *в рантайм `apps/api` попадают только библиотеки из ТЗ и модули `node:*`. Инструменты разработки разрешены, если они не импортируются из `src/` и не попадают в production-образ.*

### Runtime: `apps/api/package.json → dependencies`

| Пакет | Пункт ТЗ | Комментарий |
|---|---|---|
| `express@5` | Express | Актуальная major-версия. В v5 rejected promise из async-хендлера сам доходит до error-middleware: без обёрток `asyncHandler` |
| `axios` | axios | Клиент CoinMarketCap |
| `swagger-ui-express` | Swagger | Стандартная интеграция Swagger UI с Express. Тянет официальный `swagger-ui-dist` (swagger-api). Install-телеметрию Scarf у `swagger-ui-dist` отключаем через `"scarfSettings": { "enabled": false }` в `package.json`: в финтехе пакет не должен ничего отправлять при установке |

Больше в `dependencies` ничего нет. Всё остальное закрываем стандартными модулями:

| Задача | Обычно берут | У нас |
|---|---|---|
| SQLite | better-sqlite3 | `node:sqlite` (ADR 0003) |
| `.env` | dotenv | `process.loadEnvFile()` / `node --env-file` |
| Генерация ключей, хэши, HMAC | uuid, bcrypt | `node:crypto` |
| Логи | pino, winston | свой JSON-логгер (отдельное решение D6) |
| Валидация | zod, joi | свои валидаторы (Q9) |
| Ретраи | axios-retry, p-retry | свой retry с backoff + jitter (D8) |
| Таймеры, abort | — | `node:timers/promises`, `AbortController` |

### Tooling: `devDependencies`

| Группа | Пакеты | Зачем |
|---|---|---|
| Язык и типы | `typescript@~6.0`, `@types/node@24`, `@types/express`, `@types/supertest`, `@types/jest` | Typecheck и сборка |
| Тесты | `jest@30`, `ts-jest`, `supertest` | Jest и Supertest названы в ТЗ. Ts-jest — трансформер TS для Jest, без него Jest не читает `.ts` |
| Качество | `eslint@10`, `typescript-eslint`, `prettier`, `eslint-config-prettier` | Lint и формат (бриф §4) |
| Git hooks | `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional` | Conventional Commits и проверка до коммита |

### Сознательно **не** берём

| Пакет | Чем заменяем | Почему |
|---|---|---|
| `tsx`, `ts-node` | нативный type stripping Node 24: `node --watch src/server.ts` | Меньше зависимостей, а dev-режим исполняет тот же JS, что и прод |
| `nodemon` | `node --watch` | Встроено с Node 22 |
| `dotenv` | `--env-file` | Встроено |
| TypeScript 7 | TypeScript 6.0 | ts-jest и typescript-eslint пока не поддерживают 7.x (peer `<7` и `<6.1.0`). Переход — когда обновятся |

### Настройки TypeScript, которые вытекают из решения

- `"type": "module"` (ESM), `module`/`moduleResolution: nodenext`.
- `erasableSyntaxOnly: true`: без `enum`, `namespace` и parameter properties. Это требование нативного запуска. Вместо `enum` используем union-типы и `as const`-объекты.
- `verbatimModuleSyntax: true`, `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`: в коде пишем `import ... from './x.ts'`, `tsc` переписывает это в `.js`.
- Jest: ts-jest компилирует тесты в CommonJS (`module: commonjs`, `moduleResolution: bundler`). Так мы обходим всё ещё экспериментальный ESM-режим Jest (`--experimental-vm-modules`). Ограничение: в `src/` нет `import.meta` и top-level await. Это проверяет ESLint (`no-restricted-syntax`).
- `strict: true` и `noUncheckedIndexedAccess: true`.

### Автоматическая проверка правила

Скрипт `scripts/check-deps.ts` (без зависимостей, запускается в CI и pre-commit) проверяет две вещи:
1. `dependencies` в `apps/api` ⊆ `{express, axios, swagger-ui-express}`.
2. Каждый импорт в `apps/api/src/**` — относительный, `node:*` или пакет из того же allowlist. Заодно требуем префикс `node:` у встроенных модулей.

Production-образ собираем через `npm ci --omit=dev`. В образе физически только три пакета из ТЗ и их транзитивные зависимости, и это можно показать командой `npm ls --omit=dev`.

## Последствия

- ➕ Буква C7 соблюдена там, где она важна для проверяющего, — в рантайме. И это не обещание: CI проверяет правило на каждый коммит.
- ➕ Минимум dev-зависимостей: Node 24 сам закрывает запуск TS, watch и `.env`.
- ➕ Хорошая тема для интервью: type stripping, `erasableSyntaxOnly`, почему не TS 7, чем `dependencies` отличаются от `devDependencies`.
- ➖ Двойная настройка модулей: ESM в приложении, CommonJS в Jest. Это стандартный компромисс до стабилизации ESM в Jest, и он задокументирован.
- ➖ Запрет на `enum` и `import.meta` в `src/`. ESLint ловит это на этапе lint.
- ➖ TypeScript закреплён на `~6.0`. Обновление до 7 — отдельная задача после выхода ts-jest и typescript-eslint с поддержкой.
- Риск трактовки: проверяющий может считать иначе. Поэтому правило и его обоснование выносим в README, раздел «Ограничения ТЗ и как они соблюдены».

## Как защищать на интервью

«C7 ограничивает приложение. В `dependencies` только Express, axios и Swagger UI, всё остальное — модули `node:*`. Это проверяет скрипт в CI, а прод-образ собирается без devDependencies. ESLint, типы и ts-jest — это верстак: они не исполняются в сервисе. Там, где Node 24 умеет сам — запуск TS, watch, `.env`, — я не беру даже dev-зависимости».
