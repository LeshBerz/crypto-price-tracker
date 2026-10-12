# Запуск локально через npm

Запуск без Docker: процессы Node.js прямо на машине. Подходит для разработки — сервер перезапускается при изменении кода.

На этой странице:

- [Подготовка](#подготовка) — Node.js, зависимости, файл окружения
- [api на стабе](#api-на-стабе) — без ключа CoinMarketCap и без интернета
- [api с настоящим CoinMarketCap](#api-с-настоящим-coinmarketcap)
- [Веб-клиент](#веб-клиент)
- [Остановка и сброс](#остановка-и-сброс)

Все команды — из корня репозитория. Чем стаб отличается от настоящего CoinMarketCap — в [обзоре гайдов](README.md#стаб-и-настоящий-coinmarketcap). Если шаг не сработал — [Типовые поломки](troubleshooting.md).

## Подготовка

Выполняется один раз.

### 1. Node.js 24

Нужен Node.js ≥ 24.15. Версия записана в `.nvmrc` и в `engines` файла `package.json`. Причины ([ADR 0003](../adr/0003-sqlite-driver-and-node-version.md), [ADR 0004](../adr/0004-c7-interpretation-and-dev-tooling.md)):

- `node:sqlite` — встроенный драйвер SQLite, сторонний драйвер не нужен;
- запуск `.ts` без сборки: `node src/server.ts`;
- чтение `.env` самим Node: `--env-file-if-exists`.

Проверка:

```bash
node -v
```

Ожидается `v24.15.0` или новее. Если версия другая — менеджер версий [fnm](https://github.com/Schniz/fnm) (Windows, macOS, Linux) или nvm:

```bash
fnm install 24
```

```bash
fnm use 24
```

Чтобы нужная версия включалась сама при входе в каталог проекта, fnm подключается в профиле оболочки — [инструкция fnm](https://github.com/Schniz/fnm#shell-setup).

### 2. Зависимости

```bash
npm ci
```

`npm ci` ставит ровно те версии, что записаны в `package-lock.json`, предварительно удалив `node_modules`. Репозиторий — npm workspaces: одна установка в корне ставит зависимости и `apps/api`, и `apps/web` в общий `node_modules`.

На неподходящей версии Node.js установка сразу останавливается с ошибкой `EBADENGINE` (настройка `engine-strict` в `.npmrc`).

Проверка — команда завершилась без `npm error`, последняя строка вида `added … packages`.

### 3. Файл окружения

Файл один — `.env` в корне. Его читают npm-скрипты api, веб-клиент и `docker compose`. Подробно — [Окружение](environment.md).

Создать из шаблона, если файла ещё нет. Команда перезаписывает существующий `.env` без вопроса:

```bash
cp .env.example .env
```

## api на стабе

Два процесса в двух терминалах: стаб и api.

### Шаги

1. В `.env`:

   ```dotenv
   CMC_API_KEY=stub-cmc-key
   CMC_BASE_URL=http://localhost:4010
   ```

2. Терминал 1 — стаб:

   ```bash
   node apps/api/scripts/cmc-stub-server.ts
   ```

   Ожидается строка `cmc-stub listening on 4010`.

3. Терминал 2 — api:

   ```bash
   npm run dev -w @cpt/api
   ```

   Ожидаются строки `database ready`, `http server listening` и `sync finished`.

   Строка `.env not found. Continuing without it.` (в режиме `--watch` — дважды) ошибкой не является: она относится к необязательному файлу `apps/api/.env`, корневой `.env` при этом прочитан.

4. Терминал 3 — API-ключ. Печатается один раз, в БД хранится только хэш:

   ```bash
   npm run keys:create -w @cpt/api -- --name me --role operator
   ```

**Не меняя `.env`.** Переменные процесса сильнее файла, поэтому стаб можно включить на один запуск. Значения действуют, пока открыт терминал.

PowerShell:

```powershell
$env:CMC_API_KEY = "stub-cmc-key"; $env:CMC_BASE_URL = "http://localhost:4010"; npm run dev -w @cpt/api
```

bash:

```bash
CMC_API_KEY=stub-cmc-key CMC_BASE_URL=http://localhost:4010 npm run dev -w @cpt/api
```

### Проверка

1. <http://localhost:3000/health/ready> отвечает `200`.
2. Swagger UI — <http://localhost:3000/docs> → **Authorize** → вставить ключ.
3. `POST /api/v1/cryptocurrencies` с телом `{"symbol":"BTC"}` → `201`.
4. `POST /api/v1/sync-runs` → `202`.
5. `GET /api/v1/prices` → в ответе BTC с ценой-строкой.
6. `POST /api/v1/cryptocurrencies` с телом `{"symbol":"SOL"}` → `422`: стаб знает только BTC, ETH и MEME.

## api с настоящим CoinMarketCap

Один процесс. Каждая синхронизация и каждое добавление монеты тратят квоту ключа.

### Шаги

1. В `.env` задать свой ключ, строку `CMC_BASE_URL` убрать или закомментировать — без неё api ходит в настоящий CoinMarketCap:

   ```dotenv
   CMC_API_KEY=ваш-ключ
   # CMC_BASE_URL=
   ```

2. Проверить ключ и формат живого ответа до запуска сервиса (тратит 2 кредита):

   ```bash
   npm run smoke:cmc -w @cpt/api
   ```

3. Запустить api:

   ```bash
   npm run dev -w @cpt/api
   ```

4. Выпустить API-ключ:

   ```bash
   npm run keys:create -w @cpt/api -- --name me --role operator
   ```

### Проверка

1. Swagger UI — <http://localhost:3000/docs> → **Authorize**.
2. `POST /api/v1/cryptocurrencies` с телом `{"symbol":"SOL"}` → `201`.
3. `POST /api/v1/sync-runs` → `202`, затем `GET /api/v1/prices` → живая цена.
4. `GET /api/v1/system/cmc` → состояние интеграции и остаток квоты.

### Расход квоты

Синхронизация — 1 кредит на весь список, по умолчанию раз в 5 минут и один раз при старте. Квота плана Basic — 15 000 кредитов в месяц. Пока процесс запущен, квота расходуется: после проверки его стоит остановить.

## Веб-клиент

Веб-клиент — дополнение сверх ТЗ. Ему нужен запущенный api (любой из двух разделов выше).

### Шаги

1. Два разных ключа api — команду выполнить дважды:

   ```bash
   node -e "console.log('cpt_' + require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

2. Хэш пароля первого оператора. Команда спрашивает пароль (от 12 символов) и печатает хэш:

   ```bash
   npm run hash-password -w @cpt/web
   ```

3. Записать в `.env`. Хэш — в одинарных кавычках, знаки `$` не экранируются:

   ```dotenv
   BOOTSTRAP_VIEWER_KEY=cpt_…
   BOOTSTRAP_OPERATOR_KEY=cpt_…
   WEB_BOOTSTRAP_LOGIN=admin
   WEB_BOOTSTRAP_PASSWORD_HASH='scrypt$17$8$1$…'
   ```

4. Перезапустить api: ключи `BOOTSTRAP_*` он принимает при старте.

5. В отдельном терминале — web:

   ```bash
   npm run dev -w @cpt/web
   ```

| Процесс | Адрес | База |
|---|---|---|
| Стаб CoinMarketCap | http://localhost:4010 | — |
| api | http://localhost:3000, Swagger — `/docs` | `apps/api/data/cpt.db` |
| web | http://localhost:3001 | `apps/web/data/web.db` |

### Проверка

1. <http://localhost:3001> открывает страницу входа.
2. Вход с логином из `WEB_BOOTSTRAP_LOGIN` и паролем, от которого посчитан хэш.
3. <http://localhost:3001/operator/watchlist> → добавить BTC.
4. <http://localhost:3001/operator/sync> → «Запустить» → в журнале запуск со статусом «успешно».
5. На дашборде у BTC появилась цена.
6. С настоящим CoinMarketCap: <http://localhost:3001/operator/system> показывает расход квоты.

Без ключей web не стартует и называет переменную, которой не хватает. Экраны и маршруты — [README web](../../apps/web/README.md).

## Остановка и сброс

- **Остановить** — `Ctrl+C` в каждом терминале.
- **Начать заново** — остановить процессы и удалить каталоги `apps/api/data` и `apps/web/data`. Базы, ключи `BOOTSTRAP_*` и первый оператор создадутся при следующем старте; ключи, выпущенные командой `keys:create`, нужно выпустить снова.
- **Перед `docker compose up`** строку `CMC_BASE_URL=http://localhost:4010` закомментировать: в контейнере `localhost` — это сам контейнер.

Команды запускаются через `npm run … -w @cpt/api` из корня: пути к базе и к каталогу миграций отсчитываются от `apps/api`. Запуск `node apps/api/src/server.ts` из корня не найдёт миграции.
