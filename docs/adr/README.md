# Architecture Decision Records

Каждое значимое решение — отдельный файл `NNNN-название.md`.
Формат: контекст → варианты с таблицей сравнения → решение → последствия.
Статусы: `Proposed` (ждёт аппрува) → `Accepted` / `Rejected` → `Superseded by NNNN`.

| # | Решение | Вопрос брифа | Статус |
|---|---|---|---|
| [0001](0001-web-framework.md) | Фреймворк для `apps/web`: Next.js | Q1 | Accepted |
| [0002](0002-access-model.md) | Модель доступа: API key со scope + BFF в web | Q2 | Accepted |
| [0003](0003-sqlite-driver-and-node-version.md) | Драйвер SQLite: `node:sqlite` на Node 24 LTS | Q3 | Accepted |
| [0004](0004-c7-interpretation-and-dev-tooling.md) | Трактовка C7: runtime строго по ТЗ, tooling в devDependencies | Q7 | Accepted |
| [0005](0005-monorepo-structure.md) | Монорепо: npm workspaces, composition root для platform | Q6 | Accepted |
| [0006](0006-price-precision.md) | Цены: точный TEXT + генерируемая REAL-колонка, строки в API | Q4 | Accepted |
| [0007](0007-aggregates-and-rollups.md) | Агрегаты: сырые данные + часовая свёртка, пересчёт в транзакции синхронизации | Q5 | Accepted |
| [0008](0008-validation-and-openapi.md) | Spec-first: OpenAPI 3.0 управляет типами, валидацией и маршрутами | Q9 | Accepted |
| [0009](0009-testing-strategy.md) | Тесты: настоящая SQLite, HTTP-стаб CMC, Clock, автоматическая матрица C8 | Q12 | Accepted |
| [0010](0010-email-alert-channel.md) | Email-алерты: HTTP-API (Mailpit локально, Resend опционально), outbox в БД | Q10 | Accepted |
| [0011](0011-platform-composition.md) | Platform: Postgres + TimescaleDB, Redis, RabbitMQ, worker — по компоненту на проблему масштабирования | Q8 | Accepted |
| [0012](0012-web-charts-and-ui-kit.md) | Web: Lightweight Charts, shadcn/ui + Tailwind 4, TanStack Query | Q11 | Accepted |
| [0013](0013-data-model.md) | Доменная модель и схема БД (STRICT, CHECK, миграции forward-only) | фаза A | Accepted |
| [0014](0014-api-contract.md) | Контракт API v1 (16 операций) + поправки к 0002, 0004, 0008 | фаза A | Accepted |
| [0015](0015-ports-events-and-lifecycle.md) | Порты, события (после COMMIT), синхронизация, graceful shutdown | фаза A | Accepted |
| [0016](0016-web-auth-and-bff-routes.md) | Web: таблица пользователей + серверные сессии (OWASP), allowlist BFF с тестом-сверкой, CSRF | фаза A | Accepted |
| [0017](0017-web-ui-data-gaps.md) | Web: расписание синхронизации в `getCmcStatus`, пауза монеты на дашборде через `listCryptocurrencies` | фаза C | Proposed |
| [0018](0018-web-onboarding-tour-and-motion.md) | Web: свой гид-тренер на примитивах shadcn (запасной — react-joyride), анимации на CSS, иконки lucide-react | фаза C | Proposed |

## Порядок закрытия остальных вопросов

Сначала то, что блокирует код `apps/api` (фаза B, день 2), потом то, что нужно web и `platform`.

| Шаг | Вопросы | Почему в таком порядке |
|---|---|---|
| 1 | Q1, Q2 | Связаны: где живёт BFF, зависит от фреймворка web. Модель доступа определяет auth-модуль api |
| 2 | Q3 → Q7 → Q6 | Фундамент: версия Node и драйвер SQLite, трактовка C7 для dev-инструментов, структура монорепо. Без них нельзя начать каркас |
| 3 | Q4 → Q5 | Модель данных: точность цены и агрегаты определяют схему БД и миграции |
| 4 | Q9 → Q12 | Контракт API (spec-first) и стратегия тестов. После них пишем `openapi.yaml` |
| 5 | Q10, Q8, Q11 | Нужны только к фазам C–D: каналы алертов, БД `platform`, графики и UI-кит |
