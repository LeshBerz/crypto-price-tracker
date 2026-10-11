# Crypto Price Tracker

Backend-сервис, который ведёт список отслеживаемых криптовалют, в фоне забирает их цены из CoinMarketCap, хранит историю в SQLite и отдаёт актуальные цены, историю и агрегаты через REST API.
Тестовое задание Evercode Lab Fast Track (Backend, Node.js). Сдаваемая часть — каталог [`apps/api`](apps/api).

**Стек (строго по ТЗ):** Node.js 24 · TypeScript · Express 5 · SQLite на raw SQL (`node:sqlite`) · axios · Jest + Supertest · Swagger (OpenAPI 3.0) · Docker.
В рантайме три зависимости: `express`, `axios`, `swagger-ui-express` — это проверяет CI.

| | |
|---|---|
| Операций в контракте | 16, все реализованы |
| Тесты | 726, покрытие 100 % строк, 98,7 % веток |
| C8 | у каждой операции есть позитивный и негативный тест — [матрица](docs/project/test-matrix.md) (127 тестов) |
| CI | lint, типы, зависимости, контракт, тесты, сборка образа, smoke в Docker, остановка по `SIGTERM` |

## Запуск

### Docker (рекомендуется)

Нужен только Docker. По умолчанию сервис ходит в **стаб CoinMarketCap** из того же compose — работает без ключа CMC и без интернета.

```bash
docker compose up --build
```

API-ключ для запросов выпускается командой (ключ печатается один раз, в БД хранится только хэш):

```bash
docker compose run --rm api node dist/cli/keys.js create --name reviewer --role operator
```

Дальше — Swagger UI: <http://localhost:3000/docs> → **Authorize** → вставить ключ.

**С настоящим CoinMarketCap.** Создайте `.env` рядом с `docker-compose.yml`:

```dotenv
CMC_API_KEY=ваш-ключ
CMC_BASE_URL=https://pro-api.coinmarketcap.com
```

### Локально через npm

Нужен Node.js ≥ 24.15 (версия — в `.nvmrc`).

```bash
npm ci
```

```bash
cp .env.example apps/api/.env
```

Заполните в `apps/api/.env` ключ `CMC_API_KEY`, затем:

```bash
npm run dev -w @cpt/api
```

Ключ API: `npm run keys:create -w @cpt/api -- --name me --role operator`.
Продакшен-сборка: `npm run build -w @cpt/api`, затем `npm start -w @cpt/api`.

### Проверка одной командой

Скрипт проходит путь проверяющего: готовность → 401 без ключа → 403 с ролью viewer → добавить BTC → ручная синхронизация → цена → событие в SSE.
Ему нужны ключи, с которыми поднят сервис (`BOOTSTRAP_*` — см. ниже):

```bash
node apps/api/scripts/smoke.ts http://localhost:3000
```

## Переменные окружения

Полный список с валидацией — [`apps/api/src/config.ts`](apps/api/src/config.ts), шаблон — [`.env.example`](.env.example). Ошибка в конфиге останавливает старт с понятным сообщением, значения секретов в нём не печатаются.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `CMC_API_KEY` | — (обязательна) | Ключ CoinMarketCap. Только из окружения (D-4), уходит только заголовком запроса |
| `CMC_BASE_URL` | `https://pro-api.coinmarketcap.com` | Адрес CMC; в compose по умолчанию — стаб |
| `CMC_TIMEOUT_MS` | `10000` | Таймаут запроса к CMC (C5) |
| `SYNC_INTERVAL_MS` | `300000` | Интервал фоновой синхронизации, не меньше 180 000 (квота CMC Basic) |
| `DATABASE_PATH` | `./data/cpt.db` | Файл SQLite; каталог `data/` в `.gitignore` (C3) |
| `PORT` | `3000` | Порт HTTP |
| `LOG_LEVEL` | `info` | `debug` · `info` · `warn` · `error`; логи — JSON в stdout |
| `BOOTSTRAP_VIEWER_KEY`, `BOOTSTRAP_OPERATOR_KEY` | — | Необязательные готовые API-ключи: при старте в БД пишется их SHA-256 |

Bootstrap-ключ — это `cpt_` + 43 символа base64url. Сгенерировать: `node -e "console.log('cpt_'+require('crypto').randomBytes(32).toString('base64url'))"`.

## API

Контракт — [`apps/api/openapi/openapi.yaml`](apps/api/openapi/openapi.yaml) (OpenAPI 3.0). Он же — источник маршрутов и валидации: роутер строится из спеки, поэтому эндпоинта «мимо документации» не существует.

- Swagger UI — `/docs`, спека — `/openapi.json` (оба без ключа).
- Аутентификация — `Authorization: Bearer <API key>`. Две роли: **viewer** (`prices:read`) и **operator** (все права).
- Ошибки — `application/problem+json` (RFC 9457) с `type`, `detail`, `requestId`; у ошибок валидации — список `errors` с путём до поля.
- Цены — десятичные **строки** в USD (`"67123.451234567891"`): JSON-число потеряло бы цифры.

| Метод и путь | Что делает | Scope |
|---|---|---|
| `GET /health/live`, `GET /health/ready` | Жив ли процесс; готов ли принимать трафик (БД, миграции, не идёт остановка) | — |
| `GET /api/v1/cryptocurrencies` | Список отслеживаемых | `prices:read` |
| `POST /api/v1/cryptocurrencies` | Добавить по символу; символ проверяется в CMC | `watchlist:write` |
| `GET /api/v1/cryptocurrencies/{id}` | Одна криптовалюта | `prices:read` |
| `PATCH /api/v1/cryptocurrencies/{id}` | Изменить имя или приостановить синхронизацию | `watchlist:write` |
| `DELETE /api/v1/cryptocurrencies/{id}` | Убрать из отслеживаемых (история удаляется каскадом) | `watchlist:write` |
| `GET /api/v1/prices` | Актуальные цены всех монет, признак устаревания, изменение за 24 ч | `prices:read` |
| `GET /api/v1/prices/sparklines` | Мини-графики всех монет одним запросом | `prices:read` |
| `GET /api/v1/cryptocurrencies/{id}/prices` | История цен: период `from`/`to`, курсорная пагинация | `prices:read` |
| `GET /api/v1/cryptocurrencies/{id}/prices/aggregates` | Агрегаты `1h` · `4h` · `1d` · `1w`: OHLC, среднее, % изменения | `prices:read` |
| `GET /api/v1/sync-runs`, `GET /api/v1/sync-runs/{id}` | Журнал запусков синхронизации | `ops:read` |
| `POST /api/v1/sync-runs` | Запустить синхронизацию вручную (202; 409, если уже идёт) | `ops:write` |
| `GET /api/v1/system/cmc` | Состояние интеграции с CMC и остаток квоты | `ops:read` |
| `GET /api/v1/stream` | Поток событий SSE: `price.updated`, `sync.finished`, `watchlist.changed`, `heartbeat` | `prices:read` |

Пример (ключ — в переменной `KEY`):

```bash
curl -X POST localhost:3000/api/v1/cryptocurrencies -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"symbol":"BTC"}'
```

```bash
curl -X POST localhost:3000/api/v1/sync-runs -H "Authorization: Bearer $KEY"
```

```bash
curl localhost:3000/api/v1/prices -H "Authorization: Bearer $KEY"
```

```bash
curl "localhost:3000/api/v1/cryptocurrencies/1/prices/aggregates?interval=1h&from=2026-10-01T00:00:00Z" -H "Authorization: Bearer $KEY"
```

### Как это работает

```mermaid
flowchart LR
  C[Клиент] -->|Bearer API key| R[Роутер из openapi.yaml<br/>auth → валидация → хендлер]
  R --> S[Сервисы<br/>watchlist · цены · синхронизация]
  S -->|UnitOfWork, raw SQL| DB[(SQLite<br/>price_history + часовые свёртки)]
  P[Планировщик] --> Y[SyncService] -->|axios: таймаут, ретраи| CMC[CoinMarketCap]
  Y --> DB
  Y -->|события после COMMIT| H[SSE-хаб] --> C
```

- **Чтение не зависит от CMC.** Цены отдаются из БД. Если CMC недоступен, сервис продолжает отвечать, а цены получают `isStale: true`.
- **Синхронизация без наложения.** Следующий запуск планируется после завершения текущего; от второго процесса защищает уникальный индекс в БД.
- **Точность.** Цена от ответа CMC до ответа API идёт строкой; арифметика — свой `Decimal` на `BigInt`, без float.
- **Остановка.** По `SIGTERM`/`SIGINT`: readiness → 503, планировщик останавливается, запросы дорабатывают, SSE-клиенты получают `shutdown`, БД закрывается. `docker compose stop` завершает процесс с кодом 0 за доли секунды.

## Тесты

```bash
npm test -w @cpt/api
```

```bash
npm run check
```

`npm run check` — всё, что делает CI: ESLint, Prettier, типы, проверка зависимостей (C7), актуальность кодогенерации из контракта, тесты с покрытием и проверка C8.

- **БД не мокается:** каждый тест получает настоящую SQLite `:memory:` с миграциями.
- **CoinMarketCap — HTTP-стаб на `node:http`**, а не мок axios: таймауты, обрывы соединения, 429 с `Retry-After`, 5xx и битый JSON проверяются на настоящем сокете.
- **Время — `FakeClock`:** ретраи, планировщик и heartbeat проверяются без ожидания.
- **Каждый HTTP-ответ сверяется с контрактом** матчером `toMatchContract` — тест падает, если ответ разошёлся с `openapi.yaml`.
- **C8 доказан скриптом:** [`check-endpoint-coverage`](apps/api/scripts/check-endpoint-coverage.ts) сверяет отчёт Jest с операциями спеки и генерирует [матрицу тестов](docs/project/test-matrix.md).
- **Остановка:** unit-тест координатора и e2e с настоящим `SIGTERM` (на Linux; на Windows сигнал не доставляется, тест пропускается).

## Ограничения ТЗ и как они соблюдены

Полный чек-лист со ссылками на код и тесты — [`docs/project/requirements.md`](docs/project/requirements.md).

| | Ограничение | Как соблюдено |
|---|---|---|
| C1 | Без ORM | Только SQL-запросы в [`src/db/repositories`](apps/api/src/db/repositories), миграции — [SQL-файл](apps/api/migrations/0001_core.sql) |
| C2 | Данные только в БД | Watchlist, история, запуски синхронизации и API-ключи — в SQLite. В памяти — только открытые SSE-соединения |
| C3 | Файл БД не в репозитории | `data/`, `*.db` в `.gitignore`; в Docker — volume |
| C4 | Ключ CMC не в коде и не у клиента | Только env → заголовок запроса. Логгер маскирует секреты по имени поля и по виду значения |
| C5 | Таймауты и обработка ошибок | Один внешний клиент: таймаут, 6 кодов ошибок, ретраи с backoff и jitter только для временных сбоев |
| C6 | Остановка по SIGINT/SIGTERM | [`ShutdownCoordinator`](apps/api/src/shutdown.ts), проверено в CI настоящим сигналом и `docker compose stop` |
| C7 | Только библиотеки из ТЗ | [`scripts/check-deps.ts`](scripts/check-deps.ts) в CI и pre-commit: импорт вне списка — ошибка |
| C8 | Позитивный и негативный тест на эндпоинт | [Матрица](docs/project/test-matrix.md), проверка в CI |
| C9 | Тесты фоновых задач и ошибок внешнего API | [`tests/sync`](apps/api/tests/sync), [`tests/market-data`](apps/api/tests/market-data) |
| C10 | Валидация всех входных данных | Валидатор из спеки: path, query, body; неизвестное поле или параметр — 400 |

### Где ТЗ потребовало решения

ТЗ разрешает «только указанные библиотеки и стандартные возможности Node.js» и предлагает обосновать своё решение там, где это мешает. Таких мест четыре, каждое оформлено как ADR:

| Вопрос | Решение | Почему |
|---|---|---|
| Драйвера SQLite нет в списке | Встроенный `node:sqlite` (Node 24 LTS) — [ADR 0003](docs/adr/0003-sqlite-driver-and-node-version.md) | Стандартная возможность Node.js: ноль зависимостей и нативной сборки. «Node.js 18+» соблюдено |
| Библиотеки валидации нет в списке | Свой валидатор подмножества JSON Schema по `openapi.yaml` — [ADR 0008](docs/adr/0008-validation-and-openapi.md) | Один источник правды: документация, маршруты и валидация не расходятся. Неподдерживаемое ключевое слово — отказ старта |
| Цена во float теряет точность | `TEXT` в БД, строка в API, `Decimal` на `BigInt` — [ADR 0006](docs/adr/0006-price-precision.md) | В финтехе цену нельзя округлять молча |
| Что значит «только указанные библиотеки» | Правило действует на runtime-зависимости; dev-инструменты (ESLint, Prettier, кодогенерация типов) — нет — [ADR 0004](docs/adr/0004-c7-interpretation-and-dev-tooling.md) | В образ попадают только `express`, `axios`, `swagger-ui-express` |

Чего в сдаваемой версии нет: `dotenv` (заменён на `node --env-file`), логгера-библиотеки (свой JSON-логгер), планировщика-библиотеки (цикл ожиданий на таймере).

## Команды

Все — с `-w @cpt/api` из корня или без него из `apps/api`.

| Команда | Что делает |
|---|---|
| `npm run dev` | Сервер с перезапуском при изменениях |
| `npm run keys:create -- --name <имя> --role viewer\|operator` | Выпустить API-ключ |
| `npm run keys:revoke -- --name <имя>` | Отозвать ключ (действует со следующего запроса) |
| `npm run rollups:rebuild` | Пересобрать часовые свёртки из сырой истории |
| `npm run smoke:cmc` | Проверить формат живого ответа CMC (нужен `CMC_API_KEY`, тратит 2 кредита) |
| `npm run test:cov`, `npm run test:matrix` | Тесты с покрытием; проверка C8 и генерация матрицы |
| `npm run codegen` | Перегенерировать типы и встроенную спеку из `openapi.yaml` |

## Документация

| Раздел | Что внутри |
|---|---|
| [docs/project/requirements.md](docs/project/requirements.md) | Требования ТЗ → код и тесты |
| [docs/project/test-matrix.md](docs/project/test-matrix.md) | Тесты по каждому эндпоинту |
| [docs/adr/](docs/adr/) | Архитектурные решения: контекст, варианты, выбор, последствия |
| [docs/project/architecture.md](docs/project/architecture.md) | Обзор архитектуры и карта ADR |
| [docs/study/](docs/study/) | Разборы тем: как это сделано и почему |
| [ROADMAP.md](ROADMAP.md), [docs/dailies.md](docs/dailies.md) | План, прогресс, дейлики |
