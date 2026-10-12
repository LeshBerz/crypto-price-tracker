# Сданная версия: строго по ТЗ

Реализация задания зафиксирована тегом [`v1.0-submission`](https://github.com/LeshBerz/crypto-price-tracker/tree/v1.0-submission) (коммит `9562598`): только `apps/api`, контракт `1.0.0`, ничего сверх ТЗ.

На этой странице:

- [Запуск](#запуск)
- [Проверка](#проверка)
- [Остановка и возврат к main](#остановка-и-возврат-к-main)
- [Чем main отличается от сданной версии](#чем-main-отличается-от-сданной-версии)

## Запуск

Нужен только Docker. Сервис ходит в стаб CoinMarketCap из того же compose: ключ CMC и интернет не нужны.

```bash
git checkout v1.0-submission
```

```bash
docker compose up --build
```

После переключения на тег в каталоге лежит README сданной версии — дальше можно идти по нему. Гайдов из `docs/guides/` в теге нет: они написаны позже.

## Проверка

1. В логах есть строки `database ready`, `http server listening` и `sync finished`.
2. Выпустить API-ключ (во втором терминале). Ключ печатается один раз, в БД хранится только хэш:

   ```bash
   docker compose run --rm api node dist/cli/keys.js create --name reviewer --role operator
   ```

3. Открыть Swagger UI — <http://localhost:3000/docs> → **Authorize** → вставить ключ.
4. `POST /api/v1/cryptocurrencies` с телом `{"symbol":"BTC"}` → 201. Стаб знает BTC, ETH и MEME.
5. `POST /api/v1/sync-runs` → 202.
6. `GET /api/v1/prices` → цена BTC строкой.

Соответствие требованиям ТЗ коду и тестам — [`docs/project/requirements.md`](../project/requirements.md), тесты по каждому эндпоинту — [`docs/project/test-matrix.md`](../project/test-matrix.md).

## Остановка и возврат к main

`Ctrl+C` в терминале с compose, затем:

```bash
docker compose down -v
```

```bash
git checkout main
```

Флаг `-v` удаляет том с базой: сданная версия и `main` используют один и тот же том, без удаления в `main` останутся монеты и ключи этого запуска.

## Чем main отличается от сданной версии

Эндпоинты из ТЗ, схема БД и зависимости api после тега не менялись.

| Что | Сданная версия | `main` | Где описано |
|---|---|---|---|
| Контракт api | `1.0.0` | `1.1.0`: в ответе `GET /api/v1/system/cmc` добавлен блок `schedule` (состояние планировщика, интервал, время следующего запуска) | [ADR 0014, поправка от 12.10](../adr/0014-api-contract.md#поправка-от-1210) |
| Файл окружения для npm-скриптов | `apps/api/.env` (`cp .env.example apps/api/.env`) | `.env` в корне, общий для compose, api и web | [ADR 0004](../adr/0004-c7-interpretation-and-dev-tooling.md) |
| Веб-клиент | нет | `apps/web`, включается профилем compose | [README web](../../apps/web/README.md) |

Запуск без Docker на сданной версии описан в её README; на `main` — в гайде [Локально через npm](local.md).
