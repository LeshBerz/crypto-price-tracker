# Запуск в Docker

Нужен только Docker (Docker Desktop должен быть запущен). Node.js на машине не требуется.

На этой странице:

- [api на стабе](#api-на-стабе) — без ключа CoinMarketCap и без интернета
- [api с настоящим CoinMarketCap](#api-с-настоящим-coinmarketcap)
- [api и веб-клиент](#api-и-веб-клиент)
- [Автоматическая проверка](#автоматическая-проверка)
- [Остановка и сброс](#остановка-и-сброс)

Все команды — из корня репозитория. Чем стаб отличается от настоящего CoinMarketCap — в [обзоре гайдов](README.md#стаб-и-настоящий-coinmarketcap).

## Какие контейнеры поднимаются

| Команда | api | cmc-stub | web |
|---|---|---|---|
| `docker compose up` | да, порт 3000 | да, наружу не опубликован | нет |
| `docker compose --profile web up` | да | да | да, порт 3001 |

`docker compose` читает файл `.env` в корне репозитория, если он есть. Без файла всё работает на значениях по умолчанию.

## api на стабе

### Что нужно

Ничего, кроме Docker. Если файл `.env` существует, в нём не должно быть строки `CMC_BASE_URL` (или она закомментирована) — иначе api пойдёт по указанному адресу, а не в стаб.

### Шаги

```bash
docker compose up --build
```

Первая сборка занимает около минуты. В конце в логах:

```text
cmc-stub-1  | cmc-stub listening on 4010
api-1       | {"level":"info","msg":"database ready", …}
api-1       | {"level":"info","msg":"http server listening","port":3000, …}
api-1       | {"level":"info","msg":"sync finished", … "status":"succeeded", …}
```

Во втором терминале выпустить API-ключ. Ключ печатается один раз, в БД хранится только хэш:

```bash
docker compose run --rm api node dist/cli/keys.js create --name reviewer --role operator
```

### Проверка

1. <http://localhost:3000/health/ready> открывается в браузере и отвечает `200`.
2. Swagger UI — <http://localhost:3000/docs> → **Authorize** → вставить ключ.
3. `POST /api/v1/cryptocurrencies` с телом `{"symbol":"BTC"}` → `201`.
4. `POST /api/v1/sync-runs` → `202`.
5. `GET /api/v1/prices` → в ответе BTC с ценой-строкой.
6. `POST /api/v1/cryptocurrencies` с телом `{"symbol":"SOL"}` → `422`: стаб знает только BTC, ETH и MEME. Это признак того, что api ходит именно в стаб.

## api с настоящим CoinMarketCap

### Что нужно

Ключ CoinMarketCap (план Basic бесплатный): <https://coinmarketcap.com/api/>.

### Шаги

1. Создать `.env` из шаблона, если файла ещё нет. Команда перезаписывает существующий `.env` без вопроса:

   ```bash
   cp .env.example .env
   ```

2. Задать в `.env` две переменные:

   ```dotenv
   CMC_API_KEY=ваш-ключ
   CMC_BASE_URL=https://pro-api.coinmarketcap.com
   ```

   Одного ключа недостаточно: без `CMC_BASE_URL` compose по-прежнему направит api в стаб.

3. Запустить:

   ```bash
   docker compose up --build
   ```

4. Выпустить API-ключ — той же командой, что и для стаба:

   ```bash
   docker compose run --rm api node dist/cli/keys.js create --name reviewer --role operator
   ```

### Проверка

1. Swagger UI — <http://localhost:3000/docs> → **Authorize**.
2. `POST /api/v1/cryptocurrencies` с телом `{"symbol":"SOL"}` → `201`. Стаб ответил бы `422` — значит, api ходит в настоящий CoinMarketCap.
3. `POST /api/v1/sync-runs` → `202`, затем `GET /api/v1/prices` → живая цена.
4. `GET /api/v1/system/cmc` → состояние интеграции и остаток квоты.

### Расход квоты

- Синхронизация — 1 кредит на весь список монет, по умолчанию раз в 5 минут (около 290 кредитов в сутки).
- Проверка символа при добавлении монеты тоже обращается к CoinMarketCap.
- Квота плана Basic — 15 000 кредитов в месяц. Пока контейнер запущен, квота расходуется: после проверки сервис стоит остановить.

## api и веб-клиент

Веб-клиент — дополнение сверх ТЗ. Профиль `web` добавляет третий контейнер; источник цен выбирается так же, как в двух разделах выше.

### Что нужно

Четыре значения в `.env`. Чтобы их получить, нужен Node.js ≥ 24.15 — либо на машине, либо в одноразовом контейнере.

1. Два разных ключа api. Команду выполнить дважды:

   ```bash
   docker run --rm node:24-alpine node -e "console.log('cpt_' + require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

2. Хэш пароля первого оператора (пароль — от 12 символов). Команда спрашивает пароль и печатает хэш; ей нужен Node.js ≥ 24.15 на машине — см. [Локально → Подготовка](local.md#подготовка):

   ```bash
   npm run hash-password -w @cpt/web
   ```

3. Записать в `.env`. Хэш — в одинарных кавычках, иначе compose примет `$17` за переменную:

   ```dotenv
   BOOTSTRAP_VIEWER_KEY=cpt_…
   BOOTSTRAP_OPERATOR_KEY=cpt_…
   WEB_BOOTSTRAP_LOGIN=admin
   WEB_BOOTSTRAP_PASSWORD_HASH='scrypt$17$8$1$…'
   ```

### Шаги

```bash
docker compose --profile web up --build
```

### Проверка

1. <http://localhost:3001> открывает страницу входа.
2. Вход с логином из `WEB_BOOTSTRAP_LOGIN` и паролем, от которого посчитан хэш.
3. <http://localhost:3001/operator/watchlist> → добавить BTC.
4. <http://localhost:3001/operator/sync> → «Запустить» → в журнале запуск со статусом «успешно».
5. На дашборде у BTC появилась цена.

Без ключей контейнер web останавливается на старте и называет переменную, которой не хватает; api при этом работает. Экраны и маршруты веб-клиента — [README web](../../apps/web/README.md).

## Автоматическая проверка

Скрипт проходит весь путь сам: готовность → 401 без ключа → 403 с ролью viewer → добавить BTC → ручная синхронизация → цена → событие в потоке SSE. Его же запускает CI.

Нужен Node.js ≥ 24.15 на машине и ключи `BOOTSTRAP_VIEWER_KEY`, `BOOTSTRAP_OPERATOR_KEY` в `.env`, заданные до запуска compose (как их сгенерировать — выше).

```bash
docker compose up -d --build --wait
```

```bash
npm run smoke -w @cpt/api
```

Последняя строка успешного прогона — `smoke: OK (http://localhost:3000, BTC = … USD)`.

## Остановка и сброс

| Что нужно | Команда |
|---|---|
| Остановить, данные сохранить | `Ctrl+C`, затем `docker compose --profile web down` |
| Остановить и удалить базы (монеты, история, ключи, пользователи web) | `docker compose --profile web down -v` |

`Ctrl+C` только останавливает контейнеры. У api задано `restart: unless-stopped`, а `docker compose run` поднимает зависимости заново — после выпуска ключа контейнеры могут снова работать и занимать порт 3000. Надёжный способ освободить порт — `docker compose down`.

Данные лежат в томах `api-data` и `web-data`, а не в каталоге репозитория: локальный запуск через npm использует другие базы.
