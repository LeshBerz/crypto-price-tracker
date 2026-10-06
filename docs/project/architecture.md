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

## Схема БД

Утверждена в [ADR 0013](../adr/0013-data-model.md): ER-диаграмма, индексы, доменные правила, миграции. Проверенный DDL — [`schema/0001_core.sql`](schema/0001_core.sql) (ядро ТЗ) и [`schema/0002_alerts.sql`](schema/0002_alerts.sql) (алерты).

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
