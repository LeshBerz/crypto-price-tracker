# @cpt/web — дашборд и панель оператора

Веб-клиент к [`apps/api`](../api): Next.js 16 (App Router) как BFF и UI. Это дополнение к сдаваемой версии: ограничения ТЗ на него не действуют, а `apps/api` от него не зависит — образ api собирается и запускается без этого каталога.

**Состояние:** каркас, вход, выход и серверные сессии (задача C1). Цены, графики и панель оператора — следующие задачи фазы C в [ROADMAP](../../ROADMAP.md).

**Стек:** Next.js 16.4 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui на Base UI · `node:sqlite` (raw SQL) · Jest.

## Запуск

Нужен Node.js ≥ 24.15 (версия — в `.nvmrc`). Из корня репозитория:

```bash
npm ci
```

Создать первого оператора. Команда спросит пароль (от 12 символов) и напечатает его хэш:

```bash
npm run hash-password -w @cpt/web
```

Скопировать `apps/web/.env.example` в `apps/web/.env.local`, вписать логин и хэш. **В файле `.env.local` каждый знак `$` в хэше экранируется:** `scrypt\$17\$8\$1\$…`. Иначе загрузчик окружения Next примет `$17` за подстановку переменной, и сервер остановится на старте с ошибкой конфига.

```bash
npm run dev -w @cpt/web
```

Приложение — на http://localhost:3000. Если порт занят api, задайте другой: `npm run dev -w @cpt/web -- -p 3100`.

## Переменные окружения

Полный список с валидацией — [`src/server/config.ts`](src/server/config.ts), шаблон — [`.env.example`](.env.example).

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `WEB_DATABASE_PATH` | `./data/web.db` | SQLite с пользователями и сессиями. Отдельный файл, не БД api |
| `WEB_BOOTSTRAP_LOGIN` | — | Логин первого оператора. Создаётся при старте, если такого логина ещё нет |
| `WEB_BOOTSTRAP_PASSWORD_HASH` | — | Хэш его пароля (не сам пароль). Задаётся только вместе с логином |
| `WEB_TRUST_PROXY` | `false` | `true`, если перед web стоит обратный прокси: тогда учитываются `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` |

## Как устроен вход

Решения и обоснование — [ADR 0016](../../docs/adr/0016-web-auth-and-bff-routes.md), разбор — [docs/study/14](../../docs/study/14-web-вход-и-сессии.md).

- **Пароль** хранится как `scrypt` (N = 2^17, r = 8, p = 1), считается асинхронно, сравнивается через `timingSafeEqual`.
- **Сессия** — случайный токен 256 бит в cookie `HttpOnly; SameSite=Lax` (по HTTPS — `__Host-…; Secure`). В БД лежит только SHA-256 токена.
- **Сроки:** 2 часа бездействия, 12 часов всего. Выход отзывает сессию на сервере.
- **Подбор пароля:** после 5 неудач по паре «логин + адрес» — ожидание 1, 2, 4 … секунд, до 15 минут. Аккаунт целиком не блокируется.
- **CSRF:** `SameSite=Lax`, тело только `application/json`, заголовок `Origin` обязан совпадать с адресом web.

| Маршрут | Что делает |
|---|---|
| `POST /api/session` | Вход: `{ login, password }` → 200 и cookie; 401, 429 + `Retry-After`, 400, 403, 415 |
| `GET /api/session` | Кто вошёл: `{ login, role }` или 401 |
| `DELETE /api/session` | Выход: 204, сессия отозвана |

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev -w @cpt/web` | Режим разработки |
| `npm run build -w @cpt/web` | Продакшен-сборка (`output: standalone`) |
| `npm test -w @cpt/web` | Тесты серверной части на настоящей SQLite в памяти |
| `npm run typecheck -w @cpt/web` | Типы маршрутов Next и `tsc --noEmit` |
| `npm run hash-password -w @cpt/web` | Хэш пароля для `WEB_BOOTSTRAP_PASSWORD_HASH` |

## Структура

| Каталог | Что внутри |
|---|---|
| [`src/server/`](src/server) | Серверная логика без зависимости от Next: пароли, сессии, задержка входа, БД и миграции, обработчики `/api/session` |
| [`src/app/`](src/app) | Маршруты: `/login`, группа `(app)` за входом, Route Handlers в `api/` |
| [`src/components/`](src/components) | Шапка, навигация, меню пользователя, переключатель темы; `ui/` — компоненты shadcn/ui |
| [`src/proxy.ts`](src/proxy.ts) | Быстрый редирект на `/login` без cookie. Настоящая проверка сессии — в layout и Route Handlers |
| [`tests/`](tests) | Jest |
