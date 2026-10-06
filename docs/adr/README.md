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

## Порядок закрытия остальных вопросов

Сначала то, что блокирует код `apps/api` (фаза B, день 2), потом то, что нужно web и `platform`.

| Шаг | Вопросы | Почему в таком порядке |
|---|---|---|
| 1 | Q1, Q2 | Связаны: где живёт BFF, зависит от фреймворка web. Модель доступа определяет auth-модуль api |
| 2 | Q3 → Q7 → Q6 | Фундамент: версия Node и драйвер SQLite, трактовка C7 для dev-инструментов, структура монорепо. Без них нельзя начать каркас |
| 3 | Q4 → Q5 | Модель данных: точность цены и агрегаты определяют схему БД и миграции |
| 4 | Q9 → Q12 | Контракт API (spec-first) и стратегия тестов. После них пишем `openapi.yaml` |
| 5 | Q10, Q8, Q11 | Нужны только к фазам C–D: каналы алертов, БД `platform`, графики и UI-кит |
