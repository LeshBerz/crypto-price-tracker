# Требования задания → чек-лист

Источник: урок «Задание» курса Fast Track. Каждое требование имеет ID — на него ссылаемся в коде, тестах и заметках.

## Функциональные

Самопроверка 11.10 (E1.2): каждое требование → где код и чем доказано. Пути — от `apps/api/`.

| ID | Требование | Статус | Код | Тесты |
|---|---|---|---|---|
| F1 | Аутентификация запросов к своему API через `Bearer token (API Key)` | ✅ ключи `cpt_…`, в БД только SHA-256, сравнение `timingSafeEqual`, отзыв, роли viewer/operator, выпуск из env и CLI | [`src/auth/`](../../apps/api/src/auth/), [`src/http/auth.ts`](../../apps/api/src/http/auth.ts), [`src/cli/keys-command.ts`](../../apps/api/src/cli/keys-command.ts) | [`tests/http/auth-matrix.test.ts`](../../apps/api/tests/http/auth-matrix.test.ts) (401/403 на всех 14 защищённых операциях), [`tests/auth/`](../../apps/api/tests/auth/) |
| F2 | CRUD списка отслеживаемых криптовалют | ✅ 5 операций; символ проверяется в CMC, 409 на дубль, 422 на неизвестный символ, 503 при недоступном CMC, лимит 100 | [`src/watchlist/`](../../apps/api/src/watchlist/) | [`tests/watchlist/watchlist.test.ts`](../../apps/api/tests/watchlist/watchlist.test.ts) |
| F3 | Актуальные цены отслеживаемых криптовалют из CoinMarketCap | ✅ `GET /prices` из БД после фоновой синхронизации: `isStale`, `change24hPercent`, `lastSync`; спарклайны одним запросом | [`src/prices/`](../../apps/api/src/prices/), [`src/sync/sync-service.ts`](../../apps/api/src/sync/sync-service.ts) | [`tests/prices/prices.test.ts`](../../apps/api/tests/prices/prices.test.ts), [`tests/sync/sync.test.ts`](../../apps/api/tests/sync/sync.test.ts) |
| F4 | Сохранение истории цен в БД | ✅ `price_history` + часовая свёртка одной транзакцией; повтор той же котировки не даёт дублей; свёртка пересобирается из истории | [`src/db/repositories/prices.ts`](../../apps/api/src/db/repositories/prices.ts), [`migrations/0001_core.sql`](../../apps/api/migrations/0001_core.sql) | [`tests/sync/sync.test.ts`](../../apps/api/tests/sync/sync.test.ts), [`tests/prices/rollups-rebuild.test.ts`](../../apps/api/tests/prices/rollups-rebuild.test.ts) |
| F5 | Получение истории цен по выбранной криптовалюте | ✅ сырые точки с keyset-курсором и периодом `[from, to)`; агрегаты `1h`/`4h`/`1d`/`1w` (OHLC, avg, % изменения) | [`src/prices/price-query-service.ts`](../../apps/api/src/prices/price-query-service.ts) | [`tests/prices/prices.test.ts`](../../apps/api/tests/prices/prices.test.ts) |
| F6 | Автоматическое обновление цен в фоне | ✅ планировщик без наложения запусков, первый запуск по возрасту цен, ручной `POST /sync-runs` (202), журнал запусков, остановка по сигналу | [`src/sync/scheduler.ts`](../../apps/api/src/sync/scheduler.ts), [`src/sync/sync-service.ts`](../../apps/api/src/sync/sync-service.ts) | [`tests/sync/scheduler.test.ts`](../../apps/api/tests/sync/scheduler.test.ts), [`tests/sync/sync.test.ts`](../../apps/api/tests/sync/sync.test.ts) |
| F7 | Обработка ошибок и недоступности внешнего API | ✅ 6 кодов ошибок CMC, ретраи с backoff и jitter, 503 + `Retry-After`; синхронизация `failed`/`partial`, старые цены отдаются с `isStale`; `GET /system/cmc` | [`src/market-data/`](../../apps/api/src/market-data/), [`src/sync/sync-service.ts`](../../apps/api/src/sync/sync-service.ts) | [`tests/market-data/`](../../apps/api/tests/market-data/), [`tests/sync/sync.test.ts`](../../apps/api/tests/sync/sync.test.ts) |
| F8 | Документация API в формате OpenAPI | ✅ `openapi.yaml`, Swagger UI `/docs`, `/openapi.json`; маршруты и валидация строятся из той же спеки | [`openapi/openapi.yaml`](../../apps/api/openapi/openapi.yaml), [`src/http/router.ts`](../../apps/api/src/http/router.ts) | [`tests/contract/spec.test.ts`](../../apps/api/tests/contract/spec.test.ts), матчер `toMatchContract` в каждом HTTP-тесте |

## Данные

| ID | Требование | Статус | Код | Тесты |
|---|---|---|---|---|
| D-1 | Криптовалюта: уникальный id, символ (BTC), название, дата/время последнего обновления | ✅ таблица `cryptocurrencies`; `last_updated_at` двигает синхронизация, в API — `lastUpdatedAt` | [`migrations/0001_core.sql`](../../apps/api/migrations/0001_core.sql) | [`tests/db/schema.test.ts`](../../apps/api/tests/db/schema.test.ts), [`tests/sync/sync.test.ts`](../../apps/api/tests/sync/sync.test.ts) |
| D-2 | История: криптовалюта, цена, дата/время получения | ✅ `price_history`: монета, точная цена (TEXT), `fetched_at` + время котировки у источника | [`migrations/0001_core.sql`](../../apps/api/migrations/0001_core.sql) | [`tests/prices/prices.test.ts`](../../apps/api/tests/prices/prices.test.ts) |
| D-3 | Единая валюта цены на всё приложение (USD) | ✅ `Currency: enum [USD]` в контракте, все ответы с ценами несут `currency: USD` | [`openapi/openapi.yaml`](../../apps/api/openapi/openapi.yaml), [`src/common/decimal.ts`](../../apps/api/src/common/decimal.ts) | [`tests/common/decimal.test.ts`](../../apps/api/tests/common/decimal.test.ts) |
| D-4 | API key CoinMarketCap — только через переменные окружения | ✅ `CMC_API_KEY` обязателен, уходит только заголовком `X-CMC_PRO_API_KEY` | [`src/config.ts`](../../apps/api/src/config.ts), [`src/market-data/cmc-provider.ts`](../../apps/api/src/market-data/cmc-provider.ts) | [`tests/config.test.ts`](../../apps/api/tests/config.test.ts), [`tests/market-data/cmc-provider.test.ts`](../../apps/api/tests/market-data/cmc-provider.test.ts) |

## Ограничения

| ID | Требование | Статус | Код | Тесты / проверка |
|---|---|---|---|---|
| C1 | Без ORM — только raw SQL | ✅ SQL-запросы в репозиториях, миграции — SQL-файлы | [`src/db/repositories/`](../../apps/api/src/db/repositories/), [`migrations/`](../../apps/api/migrations/) | [`tests/db/`](../../apps/api/tests/db/); `npm run check-deps` не пропустит ORM |
| C2 | Данные не в памяти — только в БД | ✅ watchlist, история, свёртки, запуски, ключи — в SQLite. В памяти только SSE-соединения и кэш квоты CMC (перечитывается после запуска) | [`src/db/`](../../apps/api/src/db/) | [`tests/db/`](../../apps/api/tests/db/), [`tests/sync/scheduler.test.ts`](../../apps/api/tests/sync/scheduler.test.ts) (после рестарта состояние берётся из БД) |
| C3 | Файл БД не в репозитории | ✅ `data/`, `*.db` в `.gitignore`; в Docker — volume `api-data` | [`.gitignore`](../../.gitignore), [`docker-compose.yml`](../../docker-compose.yml) | job `docker` в CI |
| C4 | API key CMC не в коде и не уходит клиенту | ✅ только env → заголовок; логгер маскирует секреты; ошибка ключа CMC → 500 без деталей | [`src/common/logger.ts`](../../apps/api/src/common/logger.ts), [`src/market-data/cmc-provider.ts`](../../apps/api/src/market-data/cmc-provider.ts) | [`tests/common/logger.test.ts`](../../apps/api/tests/common/logger.test.ts), [`tests/market-data/cmc-provider.test.ts`](../../apps/api/tests/market-data/cmc-provider.test.ts) |
| C5 | Внешние запросы: таймауты + обработка ошибок | ✅ единственный внешний клиент с таймаутом и классификацией ошибок | [`src/market-data/cmc-provider.ts`](../../apps/api/src/market-data/cmc-provider.ts), [`src/market-data/retry.ts`](../../apps/api/src/market-data/retry.ts) | [`tests/market-data/`](../../apps/api/tests/market-data/) (таймаут, обрыв, 429, 5xx, битый JSON на настоящем сокете) |
| C6 | Фоновые задачи корректно останавливаются по SIGINT/SIGTERM | ✅ координатор из 8 шагов: readiness 503 → планировщик → соединения → SSE → синхронизация → БД; сторожевой таймер | [`src/shutdown.ts`](../../apps/api/src/shutdown.ts), [`src/events/sse-hub.ts`](../../apps/api/src/events/sse-hub.ts) | [`tests/shutdown.test.ts`](../../apps/api/tests/shutdown.test.ts), [`tests/e2e/sigterm.test.ts`](../../apps/api/tests/e2e/sigterm.test.ts) (настоящий `SIGTERM`, Linux), job `docker`: `docker compose stop` → код 0 |
| C7 | Только указанные библиотеки + стандартные возможности Node.js | ✅ runtime: `express`, `axios`, `swagger-ui-express`; остальное — `node:*` ([ADR 0004](../adr/0004-c7-interpretation-and-dev-tooling.md)) | [`scripts/check-deps.ts`](../../scripts/check-deps.ts) | CI и pre-commit: импорт вне списка — ошибка; `npm ls --omit=dev` |
| C8 | Каждый эндпоинт: ≥1 позитивный и ≥1 негативный тест | ✅ 16/16 операций, 127 тестов (✅ 33, ❌ 94) | [`scripts/check-endpoint-coverage.ts`](../../apps/api/scripts/check-endpoint-coverage.ts) | [матрица тестов](test-matrix.md), проверка в `npm run check` и CI |
| C9 | Тесты на фоновые задачи и ошибки внешнего API | ✅ синхронизация целиком против стаба, наложение, `partial`, `failed`, прерывание, планировщик на `FakeClock`; все виды ошибок CMC | — | [`tests/sync/`](../../apps/api/tests/sync/), [`tests/market-data/`](../../apps/api/tests/market-data/), [`tests/shutdown.test.ts`](../../apps/api/tests/shutdown.test.ts), [`tests/events/stream.test.ts`](../../apps/api/tests/events/stream.test.ts) |
| C10 | Обязательная валидация всех входных данных | ✅ path, query, body всех 16 операций из спеки; неизвестный параметр или поле → 400; 413/415; конфиг из env тоже валидируется | [`src/openapi/`](../../apps/api/src/openapi/), [`src/config.ts`](../../apps/api/src/config.ts) | [`tests/openapi/`](../../apps/api/tests/openapi/), [`tests/http/router.test.ts`](../../apps/api/tests/http/router.test.ts), [`tests/config.test.ts`](../../apps/api/tests/config.test.ts) |

**Не сделано / не проверено:**
- `npm run smoke:cmc` (формат живого ответа CMC) написан, но **не запускался**: на машине разработки нет ключа CMC. Все тесты идут против стаба, который повторяет формат CMC по документации (риск из [ADR 0006](../adr/0006-price-precision.md)). Закрывается одним запуском с настоящим ключом.

**Стек:** Node.js 18+, Express, TypeScript, SQLite, Jest + Supertest, Swagger (OpenAPI 3.0), axios, Git; Docker — приветствуется.

**Сдаём:** исходный код, инструкцию по запуску, описание API, тесты, Swagger/OpenAPI.

> «Если кажется, что выполнение задачи в рамках данных ограничений невозможно, предложите свое решение с обоснованием.» — это прямое приглашение показать инженерное мышление. Такие места — ниже.

---

## Открытые решения

Каждое решение фиксируем коротко: контекст → варианты → выбор → почему. На собеседовании про них спросят в первую очередь.

| ID | Вопрос | Суть конфликта / выбора | Предварительно |
|---|---|---|---|
| D1 | **Драйвер SQLite** | C7 разрешает только перечисленные библиотеки, а драйвера SQLite в списке нет. Варианты: встроенный `node:sqlite` (Node 22.5+, без зависимостей), `better-sqlite3` / `sqlite3` (сторонние) | ✅ [ADR 0003](../adr/0003-sqlite-driver-and-node-version.md): `node:sqlite` на Node 24 LTS (`>=24.15`), конфликта с «18+» нет |
| D2 | **Валидация** | zod/joi не в списке | ✅ [ADR 0008](../adr/0008-validation-and-openapi.md): spec-first, свой валидатор подмножества JSON Schema по `openapi.yaml`, fail-fast |
| D3 | **Загрузка `.env`** | dotenv не в списке | `process.loadEnvFile()` / `node --env-file` (Node 20.6+) |
| D4 | **Хранение цены** | `REAL` (float) теряет точность — в финтехе это красный флаг. Варианты: `TEXT` с десятичной строкой, `INTEGER` в минимальных единицах | ✅ [ADR 0006](../adr/0006-price-precision.md): точный TEXT + генерируемая REAL-колонка, строки в API, свой `Decimal` на BigInt |
| D5 | **Что значит «актуальная цена»** | Живой запрос в CMC на каждый GET или последняя цена из БД после фоновой синхронизации | Отдаём из БД + время обновления; живой запрос — опционально. Дёшево по квотам и работает при падении CMC |
| D6 | **Логгер** | pino/winston не в списке | Свой JSON-логгер поверх `console` с уровнями и requestId |
| D7 | **Swagger UI** | Нужен `swagger-ui-express` — считаем частью «Swagger» из стека | ✅ [ADR 0004](../adr/0004-c7-interpretation-and-dev-tooling.md), [0008](../adr/0008-validation-and-openapi.md): `swagger-ui-express` на `/docs`, спека — `/openapi.json` |
| D8 | **Retry и rate limit** | Библиотек ретраев нет; у CMC лимиты на запросы и кредиты | Свой retry с exponential backoff + jitter; batch-запрос всех символов одним вызовом |
| D9 | **БД в тестах** | Курс: внешние API мокаем, БД — нет | ✅ [ADR 0009](../adr/0009-testing-strategy.md): настоящая SQLite `:memory:` на каждый тест, CMC — HTTP-стаб на `node:http` |
| D10 | **Планировщик** | `setInterval` может накладывать запуски при долгом запросе | Цепочка `setTimeout` после завершения + флаг `isRunning` |
