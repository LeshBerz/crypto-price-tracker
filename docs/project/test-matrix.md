# Матрица тестов по эндпоинтам (C8)

> Файл сгенерирован: `npm run test:matrix -w @cpt/api` (отчёт Jest × операции `openapi.yaml`). Руками не править.

Операций в контракте — **16**, тестов на них — **128** (✅ 34, ❌ 94).
Требование C8: у каждой операции есть хотя бы один позитивный и один негативный тест. Проверка входит в `npm run check` и CI.

| Операция | Метод и путь | ✅ | ❌ |
|---|---|---|---|
| [`getLiveness`](#getliveness) | `GET /health/live` | 1 | 1 |
| [`getReadiness`](#getreadiness) | `GET /health/ready` | 1 | 3 |
| [`listCryptocurrencies`](#listcryptocurrencies) | `GET /api/v1/cryptocurrencies` | 2 | 4 |
| [`createCryptocurrency`](#createcryptocurrency) | `POST /api/v1/cryptocurrencies` | 2 | 20 |
| [`getCryptocurrency`](#getcryptocurrency) | `GET /api/v1/cryptocurrencies/{id}` | 2 | 5 |
| [`updateCryptocurrency`](#updatecryptocurrency) | `PATCH /api/v1/cryptocurrencies/{id}` | 2 | 7 |
| [`deleteCryptocurrency`](#deletecryptocurrency) | `DELETE /api/v1/cryptocurrencies/{id}` | 1 | 5 |
| [`listLatestPrices`](#listlatestprices) | `GET /api/v1/prices` | 2 | 4 |
| [`listSparklines`](#listsparklines) | `GET /api/v1/prices/sparklines` | 2 | 4 |
| [`listPriceHistory`](#listpricehistory) | `GET /api/v1/cryptocurrencies/{id}/prices` | 2 | 9 |
| [`getPriceAggregates`](#getpriceaggregates) | `GET /api/v1/cryptocurrencies/{id}/prices/aggregates` | 5 | 7 |
| [`listSyncRuns`](#listsyncruns) | `GET /api/v1/sync-runs` | 1 | 5 |
| [`triggerSyncRun`](#triggersyncrun) | `POST /api/v1/sync-runs` | 1 | 6 |
| [`getSyncRun`](#getsyncrun) | `GET /api/v1/sync-runs/{id}` | 1 | 4 |
| [`getCmcStatus`](#getcmcstatus) | `GET /api/v1/system/cmc` | 4 | 4 |
| [`streamEvents`](#streamevents) | `GET /api/v1/stream` | 5 | 6 |

## getLiveness

`GET /health/live`

| | Тест | Файл |
|---|---|---|
| ✅ | 200 { status: "ok" } без ключа | `tests/app.test.ts` |
| ❌ | неизвестный query-параметр → 400 validation-error (поправка R1) | `tests/app.test.ts` |

## getReadiness

`GET /health/ready`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: БД открыта, миграции применены | `tests/app.test.ts` |
| ❌ | 503 во время остановки (readiness снята на шаге 0, ADR 0015) | `tests/app.test.ts` |
| ❌ | 503: БД недоступна | `tests/app.test.ts` |
| ❌ | 503: схема БД не той версии, что знает код | `tests/app.test.ts` |

## listCryptocurrencies

`GET /api/v1/cryptocurrencies`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: items с cmcId, isPaused, lastUpdatedAt и последней ценой | `tests/watchlist/watchlist.test.ts` |
| ✅ | 200: пустой watchlist | `tests/watchlist/watchlist.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope prices:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 403 insufficient_scope: ключ только с ops:write | `tests/watchlist/watchlist.test.ts` |

## createCryptocurrency

`POST /api/v1/cryptocurrencies`

| | Тест | Файл |
|---|---|---|
| ✅ | 201 + Location; у однофамильцев BTC выбран лучший cmc_rank; событие watchlist.changed | `tests/watchlist/watchlist.test.ts` |
| ✅ | явный cmcId выбирает однофамильца | `tests/watchlist/watchlist.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope watchlist:write → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 409 already-tracked + conflictingId, без запроса в CMC | `tests/watchlist/watchlist.test.ts` |
| ❌ | 409: тот же cmcId под другим символом не добавить дважды | `tests/watchlist/watchlist.test.ts` |
| ❌ | гонка: два одновременных POST одного символа → один 201, второй 409 | `tests/watchlist/watchlist.test.ts` |
| ❌ | 422 unknown-symbol: CMC не знает символ | `tests/watchlist/watchlist.test.ts` |
| ❌ | 422 watchlist-limit-reached на 101-й монете, кредит CMC не тратится | `tests/watchlist/watchlist.test.ts` |
| ❌ | 503 upstream-unavailable + Retry-After: CMC лежит | `tests/watchlist/watchlist.test.ts` |
| ❌ | 503 при 429 от CMC: Retry-After как у CMC | `tests/watchlist/watchlist.test.ts` |
| ❌ | 503 при 429 от CMC: Retry-After не меньше 1 с | `tests/watchlist/watchlist.test.ts` |
| ❌ | 503 при 429 от CMC: Retry-After не больше 60 с | `tests/watchlist/watchlist.test.ts` |
| ❌ | 500: непредвиденная ошибка не маскируется под доменную | `tests/watchlist/watchlist.test.ts` |
| ❌ | 500 internal-error: CMC отверг наш ключ — детали только в логе | `tests/watchlist/watchlist.test.ts` |
| ❌ | 400 validation-error: символ в нижнем регистре | `tests/watchlist/watchlist.test.ts` |
| ❌ | 400 validation-error: лишнее поле | `tests/watchlist/watchlist.test.ts` |
| ❌ | 400 validation-error: число вместо строки | `tests/watchlist/watchlist.test.ts` |
| ❌ | 415: тело не JSON | `tests/watchlist/watchlist.test.ts` |
| ❌ | 413: тело больше 16 КБ | `tests/watchlist/watchlist.test.ts` |
| ❌ | 403: ключ viewer не может менять watchlist | `tests/watchlist/watchlist.test.ts` |

## getCryptocurrency

`GET /api/v1/cryptocurrencies/{id}`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: точная цена, изменение за сутки, свежесть | `tests/watchlist/watchlist.test.ts` |
| ✅ | change24hPercent = null, если истории меньше суток; свежая цена не isStale | `tests/watchlist/watchlist.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope prices:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 404 not-found | `tests/watchlist/watchlist.test.ts` |
| ❌ | 400: id=abc | `tests/watchlist/watchlist.test.ts` |

## updateCryptocurrency

`PATCH /api/v1/cryptocurrencies/{id}`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: переименование (с обрезкой пробелов) и пауза; updatedAt сдвинулся; событие updated | `tests/watchlist/watchlist.test.ts` |
| ✅ | 200: поле, которого нет в теле, не меняется | `tests/watchlist/watchlist.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope watchlist:write → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 400: пустое тело (minProperties) | `tests/watchlist/watchlist.test.ts` |
| ❌ | 400: symbol менять нельзя (additionalProperties) | `tests/watchlist/watchlist.test.ts` |
| ❌ | 400: имя из пробелов | `tests/watchlist/watchlist.test.ts` |
| ❌ | 404 | `tests/watchlist/watchlist.test.ts` |

## deleteCryptocurrency

`DELETE /api/v1/cryptocurrencies/{id}`

| | Тест | Файл |
|---|---|---|
| ✅ | 204: история удалена каскадом, событие removed | `tests/watchlist/watchlist.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope watchlist:write → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 404 | `tests/watchlist/watchlist.test.ts` |
| ❌ | 403: ключ viewer | `tests/watchlist/watchlist.test.ts` |

## listLatestPrices

`GET /api/v1/prices`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: точная строка цены, change24h, isStale, latest = null без цен, lastSync = null до первого запуска | `tests/prices/prices.test.ts` |
| ✅ | 200: lastSync — самый свежий запуск, в том числе ещё идущий | `tests/prices/prices.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope prices:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 401: ключ отозван | `tests/prices/prices.test.ts` |

## listSparklines

`GET /api/v1/prices/sparklines`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: 24h по умолчанию — часовые точки окна, пустой points у монеты без данных | `tests/prices/prices.test.ts` |
| ✅ | 200: 7d — бакеты по 4 ч, close бакета — close его последнего часа | `tests/prices/prices.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope prices:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 400: window=1y | `tests/prices/prices.test.ts` |

## listPriceHistory

`GET /api/v1/cryptocurrencies/{id}/prices`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: страницы от новых к старым без дублей и пропусков, даже если между запросами пришла новая цена | `tests/prices/prices.test.ts` |
| ✅ | 200: период [from, to) — from включительно, to нет; формат точки | `tests/prices/prices.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope prices:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 400: from без зоны | `tests/prices/prices.test.ts` |
| ❌ | 400: битый cursor | `tests/prices/prices.test.ts` |
| ❌ | 400: limit=0 | `tests/prices/prices.test.ts` |
| ❌ | 400: limit=1001 | `tests/prices/prices.test.ts` |
| ❌ | 400: from не раньше to | `tests/prices/prices.test.ts` |
| ❌ | 404: монета не отслеживается | `tests/prices/prices.test.ts` |

## getPriceAggregates

`GET /api/v1/cryptocurrencies/{id}/prices/aggregates`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: 1h — свёртки как есть, avg до 10 значащих цифр, сводка за период, to по умолчанию — сейчас | `tests/prices/prices.test.ts` |
| ✅ | 200: 1d — часы собраны в сутки; min/max — точные наблюдённые цены, а не лексикографические | `tests/prices/prices.test.ts` |
| ✅ | 200: 1w — неделя начинается с понедельника; 4h — бакеты по 4 часа | `tests/prices/prices.test.ts` |
| ✅ | 200: данных за период нет — summary = null, пустые бакеты не выдумываются | `tests/prices/prices.test.ts` |
| ✅ | 200: ровно 1000 бакетов — ещё можно | `tests/prices/prices.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope prices:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 400: больше 1000 бакетов | `tests/prices/prices.test.ts` |
| ❌ | 400: нет interval | `tests/prices/prices.test.ts` |
| ❌ | 400: from в будущем (to по умолчанию — сейчас) | `tests/prices/prices.test.ts` |
| ❌ | 404: монета не отслеживается | `tests/prices/prices.test.ts` |

## listSyncRuns

`GET /api/v1/sync-runs`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: от новых к старым, курсорная пагинация | `tests/sync/sync.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope ops:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 400: битый cursor | `tests/sync/sync.test.ts` |
| ❌ | 403: ключ только с prices:read | `tests/sync/sync.test.ts` |

## triggerSyncRun

`POST /api/v1/sync-runs`

| | Тест | Файл |
|---|---|---|
| ✅ | 202 + Location; запуск дошёл до succeeded: цены, свёртка, last_updated_at, события после записи | `tests/sync/sync.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope ops:write → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 409 sync-already-running + conflictingId, пока идёт запуск этого процесса (слой 1 — без записи в БД) | `tests/sync/sync.test.ts` |
| ❌ | 409: запуск идёт в другом процессе — срабатывает уникальный индекс БД (слой 2) | `tests/sync/sync.test.ts` |
| ❌ | 500: запись запуска не создалась (БД недоступна) — флаг процесса снят, следующий запуск возможен | `tests/sync/sync.test.ts` |

## getSyncRun

`GET /api/v1/sync-runs/{id}`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: завершённый запуск по id — статус, счётчики и время | `tests/sync/sync.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope ops:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 404: запуска нет · 400: id не число | `tests/sync/sync.test.ts` |

## getCmcStatus

`GET /api/v1/system/cmc`

| | Тест | Файл |
|---|---|---|
| ✅ | 200: до первого обращения к CMC — всё null; запуск с пустым watchlist успехом CMC не считается | `tests/sync/sync.test.ts` |
| ✅ | 200: кредиты из стаба, последний успех и последняя ошибка | `tests/sync/sync.test.ts` |
| ✅ | 200: schedule — состояние и время следующего запуска от планировщика, интервал из конфига | `tests/sync/sync.test.ts` |
| ✅ | сбой key/info не портит запуск: quota остаётся null, предупреждение в логе | `tests/sync/sync.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope ops:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
| ❌ | 403: ключ только с prices:read | `tests/sync/sync.test.ts` |

## streamEvents

`GET /api/v1/stream`

| | Тест | Файл |
|---|---|---|
| ✅ | 200 text/event-stream: price.updated и sync.finished после синхронизации, с полем id | `tests/events/stream.test.ts` |
| ✅ | watchlist.changed доходит до всех подключённых клиентов | `tests/events/stream.test.ts` |
| ✅ | heartbeat каждые 25 с по FakeClock | `tests/events/stream.test.ts` |
| ✅ | клиент отключился — хаб забывает соединение и останавливает heartbeat | `tests/events/stream.test.ts` |
| ✅ | closeAll: клиент получает shutdown, поток закрывается; новый клиент — сразу shutdown | `tests/events/stream.test.ts` |
| ❌ | 401 без ключа | `tests/events/stream.test.ts` |
| ❌ | 403 без scope prices:read | `tests/events/stream.test.ts` |
| ❌ | 400 на неизвестный query-параметр | `tests/events/stream.test.ts` |
| ❌ | без ключа → 401, WWW-Authenticate: Bearer | `tests/http/auth-matrix.test.ts` |
| ❌ | отозванный ключ → 401 invalid_token | `tests/http/auth-matrix.test.ts` |
| ❌ | ключ без scope prices:read → 403 insufficient_scope | `tests/http/auth-matrix.test.ts` |
