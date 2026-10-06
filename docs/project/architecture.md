# Архитектура (черновик)

> Черновик этапа 0. Уточняется на этапах 1–2.

## Слои

Зависимости направлены внутрь: HTTP знает о сервисах, сервисы — о репозиториях, но не наоборот.

```mermaid
flowchart LR
  Client([Клиент]) -->|HTTP + Bearer| MW[Middleware<br/>requestId · auth · json · errors]
  MW --> R[Routes]
  R --> C[Controllers<br/>валидация · HTTP-ответ]
  C --> S[Services<br/>бизнес-логика]
  S --> Repo[Repositories<br/>raw SQL]
  Repo --> DB[(SQLite)]
  S --> CMC[CoinMarketCap client<br/>axios · timeout · retry]
  CMC --> Ext([CoinMarketCap API])
  Sch[TaskScheduler] --> S
```

## Синхронизация цен

```mermaid
sequenceDiagram
  participant T as TaskScheduler
  participant S as PriceService
  participant API as CMC client
  participant DB as SQLite
  T->>S: syncPrices()
  S->>DB: SELECT отслеживаемые символы
  S->>API: GET /quotes/latest?symbol=BTC,ETH,...
  alt успех
    API-->>S: цены в USD
    S->>DB: BEGIN · INSERT price_history · UPDATE last_updated_at · COMMIT
  else таймаут / 5xx / 429
    API-->>S: ошибка после retry
    S-->>T: лог + статус «failed», старые данные остаются
  end
  T->>T: setTimeout(следующий запуск)
```

## Схема БД (черновик)

```mermaid
erDiagram
  cryptocurrencies ||--o{ price_history : has
  cryptocurrencies {
    INTEGER id PK
    TEXT symbol UK "BTC, ETH"
    TEXT name
    TEXT last_updated_at "ISO 8601, nullable"
    TEXT created_at
  }
  price_history {
    INTEGER id PK
    INTEGER cryptocurrency_id FK "ON DELETE CASCADE"
    TEXT price "решение D4"
    TEXT fetched_at "ISO 8601"
  }
```

Индекс: `price_history (cryptocurrency_id, fetched_at)` — история всегда читается по монете и периоду.

## Эндпоинты (черновик)

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| GET | `/status` | — | Health-check |
| GET | `/docs` | — | Swagger UI |
| GET | `/api/cryptocurrencies` | ✔ | Список отслеживаемых |
| POST | `/api/cryptocurrencies` | ✔ | Добавить монету (по символу) |
| GET | `/api/cryptocurrencies/:id` | ✔ | Одна монета |
| PATCH | `/api/cryptocurrencies/:id` | ✔ | Изменить |
| DELETE | `/api/cryptocurrencies/:id` | ✔ | Удалить (вместе с историей) |
| GET | `/api/prices` | ✔ | Актуальные цены всех отслеживаемых |
| GET | `/api/cryptocurrencies/:id/prices` | ✔ | История: `from`, `to`, `limit` |

## Структура папок (план)

```
src/
  app.ts            # сборка Express-приложения (без listen — удобно для Supertest)
  server.ts         # точка входа: listen, scheduler, graceful shutdown
  config/           # чтение и проверка env
  db/               # подключение, миграции
  modules/
    cryptocurrencies/   # routes, controller, service, repository, validation
    prices/
  integrations/coinmarketcap/
  jobs/             # TaskScheduler, задачи
  common/           # errors, logger, middleware, utils
tests/
docs/
```
