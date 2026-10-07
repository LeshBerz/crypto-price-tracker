// Сгенерировано scripts/codegen-spec.ts из openapi/openapi.yaml — не редактировать руками.
// Тип unknown намеренно: структуру проверяет компилятор спеки при старте (ADR 0008, fail-fast).
export const openapiDocument: unknown = {
  "openapi": "3.0.3",
  "info": {
    "title": "Crypto Price Tracker API",
    "version": "1.0.0",
    "description": "REST API для отслеживания и агрегации цен криптовалют (CoinMarketCap).\n\n**Соглашения** (ADR 0014):\n- Аутентификация: `Authorization: Bearer <API key>`. Права — scope ключа, указаны в `x-required-scopes` каждой операции.\n- Цены и проценты — **строки** с точной десятичной записью (ADR 0006). Валюта одна на всё приложение — `USD`.\n- Время — ISO 8601 UTC (`2026-10-06T12:00:00.000Z`). Во входных параметрах зона обязательна.\n- Ошибки — RFC 9457 Problem Details (`application/problem+json`).\n- Каждый ответ содержит заголовок `X-Request-Id`; входящий валидный `X-Request-Id` переиспользуется.\n- Неизвестный query-параметр → 400 у любой операции. Неизвестный путь → 404 `not-found`. Известный путь с неподдерживаемым\n  методом → 405 `method-not-allowed` и заголовок `Allow` (RFC 9110). Эти ответы формирует роутер, а не операция.\n"
  },
  "servers": [
    {
      "url": "http://localhost:3000",
      "description": "Локальный запуск (docker compose)"
    }
  ],
  "security": [
    {
      "bearerAuth": []
    }
  ],
  "tags": [
    {
      "name": "Watchlist",
      "description": "Отслеживаемые криптовалюты (ТЗ, F2)"
    },
    {
      "name": "Prices",
      "description": "Актуальные цены, история и агрегаты (ТЗ, F3–F5)"
    },
    {
      "name": "Operations",
      "description": "Синхронизация, состояние CoinMarketCap, realtime (расширение)"
    },
    {
      "name": "Health",
      "description": "Liveness и readiness"
    }
  ],
  "paths": {
    "/health/live": {
      "get": {
        "tags": [
          "Health"
        ],
        "operationId": "getLiveness",
        "summary": "Процесс жив",
        "security": [],
        "responses": {
          "200": {
            "description": "Процесс обрабатывает запросы",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Liveness"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          }
        }
      }
    },
    "/health/ready": {
      "get": {
        "tags": [
          "Health"
        ],
        "operationId": "getReadiness",
        "summary": "Готов принимать трафик",
        "description": "Проверяет БД и применённые миграции. **Доступность CoinMarketCap сюда не входит**: при падении CMC\nсервис продолжает отдавать сохранённые данные (graceful degradation) и не должен выводиться из балансировки.\n",
        "security": [],
        "responses": {
          "200": {
            "description": "Готов",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Readiness"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "503": {
            "description": "Не готов (например, БД недоступна)",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Readiness"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/cryptocurrencies": {
      "get": {
        "tags": [
          "Watchlist"
        ],
        "operationId": "listCryptocurrencies",
        "summary": "Список отслеживаемых криптовалют",
        "description": "Все отслеживаемые монеты с последней ценой. Размер watchlist ограничен (`maxItems`), поэтому без пагинации.",
        "x-required-scopes": [
          "prices:read"
        ],
        "responses": {
          "200": {
            "description": "Список",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/CryptocurrencyList"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      },
      "post": {
        "tags": [
          "Watchlist"
        ],
        "operationId": "createCryptocurrency",
        "summary": "Добавить криптовалюту в отслеживаемые",
        "description": "Символ проверяется в CoinMarketCap. Символы в CMC не уникальны: без `cmcId` выбирается активная монета\nс лучшим рангом, `cmcId` позволяет выбрать явно (ADR 0013). Название берётся из CMC.\n",
        "x-required-scopes": [
          "watchlist:write"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateCryptocurrencyRequest"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Добавлена",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              },
              "Location": {
                "description": "URL созданного ресурса",
                "schema": {
                  "type": "string",
                  "example": "/api/v1/cryptocurrencies/1"
                }
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Cryptocurrency"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          },
          "413": {
            "$ref": "#/components/responses/PayloadTooLarge"
          },
          "415": {
            "$ref": "#/components/responses/UnsupportedMediaType"
          },
          "422": {
            "$ref": "#/components/responses/Unprocessable"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          },
          "503": {
            "$ref": "#/components/responses/UpstreamUnavailable"
          }
        }
      }
    },
    "/api/v1/cryptocurrencies/{id}": {
      "parameters": [
        {
          "$ref": "#/components/parameters/CryptocurrencyId"
        }
      ],
      "get": {
        "tags": [
          "Watchlist"
        ],
        "operationId": "getCryptocurrency",
        "summary": "Одна криптовалюта",
        "x-required-scopes": [
          "prices:read"
        ],
        "responses": {
          "200": {
            "description": "Найдена",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Cryptocurrency"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      },
      "patch": {
        "tags": [
          "Watchlist"
        ],
        "operationId": "updateCryptocurrency",
        "summary": "Изменить отображаемое имя или приостановить синхронизацию",
        "description": "Меняются только `name` и `isPaused`. Символ и `cmcId` — идентичность монеты, их смена = удаление и добавление.",
        "x-required-scopes": [
          "watchlist:write"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/UpdateCryptocurrencyRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Изменена",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Cryptocurrency"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "413": {
            "$ref": "#/components/responses/PayloadTooLarge"
          },
          "415": {
            "$ref": "#/components/responses/UnsupportedMediaType"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      },
      "delete": {
        "tags": [
          "Watchlist"
        ],
        "operationId": "deleteCryptocurrency",
        "summary": "Убрать из отслеживаемых",
        "description": "Удаляет монету вместе с историей цен и агрегатами (ADR 0013). Для паузы без удаления — `PATCH isPaused`.",
        "x-required-scopes": [
          "watchlist:write"
        ],
        "responses": {
          "204": {
            "description": "Удалена",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/v1/prices": {
      "get": {
        "tags": [
          "Prices"
        ],
        "operationId": "listLatestPrices",
        "summary": "Актуальные цены всех отслеживаемых криптовалют",
        "description": "Отдаются из БД после фоновой синхронизации (решение D5): ответ не зависит от доступности CMC и не тратит квоту.\nСвежесть видна по `fetchedAt`, `isStale` и `lastSync`. Монета без единой цены — `latest: null`.\n",
        "x-required-scopes": [
          "prices:read"
        ],
        "responses": {
          "200": {
            "description": "Цены",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/LatestPriceList"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/v1/prices/sparklines": {
      "get": {
        "tags": [
          "Prices"
        ],
        "operationId": "listSparklines",
        "summary": "Мини-графики цен всех отслеживаемых криптовалют одним запросом",
        "description": "Цены закрытия бакетов из часовых свёрток (ADR 0007) — **один запрос на весь watchlist** вместо запроса агрегатов\nна каждую монету (N+1). `24h` — 24 точки по 1 ч, `7d` — 42 точки по 4 ч. Монета без данных — пустой `points`.\n",
        "x-required-scopes": [
          "prices:read"
        ],
        "parameters": [
          {
            "name": "window",
            "in": "query",
            "required": false,
            "schema": {
              "type": "string",
              "enum": [
                "24h",
                "7d"
              ],
              "default": "24h"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Мини-графики",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SparklineList"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/v1/cryptocurrencies/{id}/prices": {
      "parameters": [
        {
          "$ref": "#/components/parameters/CryptocurrencyId"
        }
      ],
      "get": {
        "tags": [
          "Prices"
        ],
        "operationId": "listPriceHistory",
        "summary": "История цен криптовалюты",
        "description": "Сырые точки, от новых к старым, курсорная пагинация. Период `[from, to)`.",
        "x-required-scopes": [
          "prices:read"
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/From"
          },
          {
            "$ref": "#/components/parameters/To"
          },
          {
            "$ref": "#/components/parameters/Limit"
          },
          {
            "$ref": "#/components/parameters/Cursor"
          }
        ],
        "responses": {
          "200": {
            "description": "Страница истории",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PriceHistoryPage"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/v1/cryptocurrencies/{id}/prices/aggregates": {
      "parameters": [
        {
          "$ref": "#/components/parameters/CryptocurrencyId"
        }
      ],
      "get": {
        "tags": [
          "Prices"
        ],
        "operationId": "getPriceAggregates",
        "summary": "Агрегаты цен по интервалам (OHLC, avg, % изменения)",
        "description": "Бакеты выровнены по UTC, недели — с понедельника. Пустые бакеты не выдумываются: их нет в ответе (ADR 0007).\nОграничение: `(to − from) / interval ≤ 1000`, иначе 400. `avg` — статистика, округлена до 10 значащих цифр.\n",
        "x-required-scopes": [
          "prices:read"
        ],
        "parameters": [
          {
            "name": "interval",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string",
              "enum": [
                "1h",
                "4h",
                "1d",
                "1w"
              ]
            }
          },
          {
            "$ref": "#/components/parameters/FromRequired"
          },
          {
            "$ref": "#/components/parameters/To"
          }
        ],
        "responses": {
          "200": {
            "description": "Агрегаты",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PriceAggregates"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/v1/sync-runs": {
      "get": {
        "tags": [
          "Operations"
        ],
        "operationId": "listSyncRuns",
        "summary": "История запусков синхронизации",
        "x-required-scopes": [
          "ops:read"
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/Limit"
          },
          {
            "$ref": "#/components/parameters/Cursor"
          }
        ],
        "responses": {
          "200": {
            "description": "Страница запусков, от новых к старым",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SyncRunPage"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      },
      "post": {
        "tags": [
          "Operations"
        ],
        "operationId": "triggerSyncRun",
        "summary": "Запустить синхронизацию вручную",
        "description": "Асинхронно — ответ 202 сразу, статус смотреть по `Location`. Если запуск уже идёт — 409 с его id.",
        "x-required-scopes": [
          "ops:write"
        ],
        "responses": {
          "202": {
            "description": "Запуск принят",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              },
              "Location": {
                "description": "URL запуска",
                "schema": {
                  "type": "string",
                  "example": "/api/v1/sync-runs/42"
                }
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SyncRun"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/v1/sync-runs/{id}": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "$ref": "#/components/schemas/Id"
          }
        }
      ],
      "get": {
        "tags": [
          "Operations"
        ],
        "operationId": "getSyncRun",
        "summary": "Один запуск синхронизации",
        "x-required-scopes": [
          "ops:read"
        ],
        "responses": {
          "200": {
            "description": "Запуск",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SyncRun"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/v1/system/cmc": {
      "get": {
        "tags": [
          "Operations"
        ],
        "operationId": "getCmcStatus",
        "summary": "Состояние интеграции с CoinMarketCap и квоты",
        "description": "Последний успех и последняя ошибка обращения к CMC, использование кредитов (по данным CMC `key/info`, кэшируется).",
        "x-required-scopes": [
          "ops:read"
        ],
        "responses": {
          "200": {
            "description": "Состояние",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/CmcStatus"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/v1/stream": {
      "get": {
        "tags": [
          "Operations"
        ],
        "operationId": "streamEvents",
        "summary": "Поток событий (Server-Sent Events)",
        "description": "Долгоживущее соединение `text/event-stream`. В браузер не отдаётся напрямую — проксируется BFF (ADR 0001, 0002).\n\n| `event:` | `data:` (JSON) | Когда |\n|---|---|---|\n| `price.updated` | `{ cryptocurrencyId, symbol, price, currency, sourceUpdatedAt, fetchedAt }` | новая цена сохранена |\n| `sync.finished` | `SyncRun` | запуск синхронизации завершён |\n| `watchlist.changed` | `{ cryptocurrencyId, change: 'added' \\| 'updated' \\| 'removed' }` | монета добавлена, изменена или удалена — клиент перечитывает список |\n| `heartbeat` | `{}` | каждые 25 с — держит соединение через прокси |\n\nПоле `id:` каждого события позволяет переподключиться с `Last-Event-ID` (пропущенные события не досылаются:\nклиент после переподключения перечитывает состояние через REST).\n",
        "x-required-scopes": [
          "prices:read"
        ],
        "responses": {
          "200": {
            "description": "Поток событий",
            "headers": {
              "X-Request-Id": {
                "$ref": "#/components/headers/XRequestId"
              }
            },
            "content": {
              "text/event-stream": {
                "schema": {
                  "type": "string"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "API key вида `cpt_…`. Выпуск — CLI `npm run keys:create` (ADR 0002)."
      }
    },
    "headers": {
      "XRequestId": {
        "description": "Идентификатор запроса для корреляции логов",
        "schema": {
          "type": "string",
          "maxLength": 64,
          "example": "7f3c1a2e-5b6d-4e8f-9a0b-1c2d3e4f5a6b"
        }
      }
    },
    "parameters": {
      "CryptocurrencyId": {
        "name": "id",
        "in": "path",
        "required": true,
        "description": "Внутренний id криптовалюты",
        "schema": {
          "$ref": "#/components/schemas/Id"
        }
      },
      "From": {
        "name": "from",
        "in": "query",
        "required": false,
        "description": "Начало периода (включительно), ISO 8601 с зоной",
        "schema": {
          "type": "string",
          "format": "date-time"
        }
      },
      "FromRequired": {
        "name": "from",
        "in": "query",
        "required": true,
        "description": "Начало периода (включительно), ISO 8601 с зоной",
        "schema": {
          "type": "string",
          "format": "date-time"
        }
      },
      "To": {
        "name": "to",
        "in": "query",
        "required": false,
        "description": "Конец периода (не включительно), ISO 8601 с зоной. По умолчанию — текущий момент",
        "schema": {
          "type": "string",
          "format": "date-time"
        }
      },
      "Limit": {
        "name": "limit",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000,
          "default": 100
        }
      },
      "Cursor": {
        "name": "cursor",
        "in": "query",
        "required": false,
        "description": "Непрозрачный курсор из `nextCursor` предыдущей страницы",
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9_-]+$"
        }
      }
    },
    "responses": {
      "ValidationError": {
        "description": "Невалидный запрос (схема, формат, лимиты)",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            },
            "example": {
              "type": "urn:cpt:problem:validation-error",
              "title": "Validation failed",
              "status": 400,
              "detail": "Request has 1 invalid field",
              "requestId": "7f3c1a2e-5b6d-4e8f-9a0b-1c2d3e4f5a6b",
              "errors": [
                {
                  "path": "/body/symbol",
                  "message": "must match pattern ^[A-Z0-9]{1,15}$"
                }
              ]
            }
          }
        }
      },
      "Unauthorized": {
        "description": "Нет ключа, ключ неверный или отозван",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          },
          "WWW-Authenticate": {
            "schema": {
              "type": "string",
              "example": "Bearer"
            }
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      },
      "Forbidden": {
        "description": "У ключа нет нужного scope",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          },
          "WWW-Authenticate": {
            "schema": {
              "type": "string",
              "example": "Bearer error=\"insufficient_scope\", scope=\"watchlist:write\""
            }
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      },
      "NotFound": {
        "description": "Ресурс не найден",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      },
      "Conflict": {
        "description": "Конфликт состояния (монета уже отслеживается; синхронизация уже идёт)",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      },
      "PayloadTooLarge": {
        "description": "Тело запроса больше 16 КБ",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      },
      "UnsupportedMediaType": {
        "description": "Тело запроса не `application/json`",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      },
      "Unprocessable": {
        "description": "Запрос корректен по схеме, но не проходит бизнес-проверку (символ не найден в CMC, превышен лимит watchlist)",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      },
      "UpstreamUnavailable": {
        "description": "CoinMarketCap недоступен, а операция без него невозможна (проверка символа при добавлении)",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          },
          "Retry-After": {
            "schema": {
              "type": "integer",
              "example": 30
            }
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      },
      "InternalError": {
        "description": "Внутренняя ошибка. Детали — только в логах по `requestId`",
        "headers": {
          "X-Request-Id": {
            "$ref": "#/components/headers/XRequestId"
          }
        },
        "content": {
          "application/problem+json": {
            "schema": {
              "$ref": "#/components/schemas/Problem"
            }
          }
        }
      }
    },
    "schemas": {
      "Id": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991,
        "example": 1
      },
      "Decimal": {
        "type": "string",
        "description": "Неотрицательное десятичное число строкой, без экспоненты и лишних нулей (ADR 0006)",
        "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]*[1-9])?$",
        "maxLength": 40,
        "example": "67123.451234567891"
      },
      "SignedDecimal": {
        "type": "string",
        "description": "Десятичное число со знаком строкой (для процентов изменения)",
        "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]*[1-9])?$",
        "maxLength": 41,
        "example": "-1.2345"
      },
      "Currency": {
        "type": "string",
        "enum": [
          "USD"
        ],
        "description": "Единая валюта приложения (D-3)"
      },
      "Timestamp": {
        "type": "string",
        "format": "date-time",
        "example": "2026-10-06T12:00:00.000Z"
      },
      "Symbol": {
        "type": "string",
        "pattern": "^[A-Z0-9]{1,15}$",
        "example": "BTC"
      },
      "Liveness": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "status"
        ],
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "ok"
            ]
          }
        }
      },
      "Readiness": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "status",
          "checks"
        ],
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "ok",
              "fail"
            ]
          },
          "checks": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "database",
              "migrations",
              "scheduler"
            ],
            "properties": {
              "database": {
                "type": "string",
                "enum": [
                  "ok",
                  "fail"
                ]
              },
              "migrations": {
                "type": "string",
                "enum": [
                  "ok",
                  "fail"
                ]
              },
              "scheduler": {
                "type": "string",
                "enum": [
                  "running",
                  "stopped",
                  "disabled"
                ]
              }
            }
          }
        }
      },
      "CreateCryptocurrencyRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "symbol"
        ],
        "properties": {
          "symbol": {
            "$ref": "#/components/schemas/Symbol"
          },
          "cmcId": {
            "type": "integer",
            "minimum": 1,
            "description": "Явный выбор монеты CMC, если символ неоднозначен"
          }
        }
      },
      "UpdateCryptocurrencyRequest": {
        "type": "object",
        "additionalProperties": false,
        "minProperties": 1,
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": "\\S"
          },
          "isPaused": {
            "type": "boolean"
          }
        }
      },
      "LatestPrice": {
        "type": "object",
        "description": "Последняя сохранённая цена. `sourceUpdatedAt` — время котировки в CMC, `fetchedAt` — когда сервис её получил.\n",
        "additionalProperties": false,
        "required": [
          "price",
          "currency",
          "sourceUpdatedAt",
          "fetchedAt",
          "change24hPercent",
          "isStale"
        ],
        "properties": {
          "price": {
            "$ref": "#/components/schemas/Decimal"
          },
          "currency": {
            "$ref": "#/components/schemas/Currency"
          },
          "sourceUpdatedAt": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "fetchedAt": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "change24hPercent": {
            "type": "string",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/SignedDecimal"
              }
            ],
            "description": "Изменение за 24 ч по собственной истории; `null`, если истории меньше суток"
          },
          "isStale": {
            "type": "boolean",
            "description": "Цена старше двух интервалов синхронизации (CMC недоступен или синхронизация остановлена)"
          }
        }
      },
      "Cryptocurrency": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "cmcId",
          "symbol",
          "name",
          "isPaused",
          "lastUpdatedAt",
          "createdAt",
          "updatedAt",
          "latestPrice"
        ],
        "properties": {
          "id": {
            "$ref": "#/components/schemas/Id"
          },
          "cmcId": {
            "type": "integer",
            "minimum": 1,
            "example": 1
          },
          "symbol": {
            "$ref": "#/components/schemas/Symbol"
          },
          "name": {
            "type": "string",
            "example": "Bitcoin"
          },
          "isPaused": {
            "type": "boolean"
          },
          "lastUpdatedAt": {
            "type": "string",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/Timestamp"
              }
            ],
            "description": "Когда сохранена последняя цена (D-1); `null` до первой синхронизации"
          },
          "createdAt": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "updatedAt": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "latestPrice": {
            "type": "object",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/LatestPrice"
              }
            ]
          }
        }
      },
      "CryptocurrencyList": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "items"
        ],
        "properties": {
          "items": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "#/components/schemas/Cryptocurrency"
            }
          }
        }
      },
      "LatestPriceListItem": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "cryptocurrencyId",
          "symbol",
          "name",
          "latest"
        ],
        "properties": {
          "cryptocurrencyId": {
            "$ref": "#/components/schemas/Id"
          },
          "symbol": {
            "$ref": "#/components/schemas/Symbol"
          },
          "name": {
            "type": "string"
          },
          "latest": {
            "type": "object",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/LatestPrice"
              }
            ]
          }
        }
      },
      "LatestPriceList": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "currency",
          "lastSync",
          "items"
        ],
        "properties": {
          "currency": {
            "$ref": "#/components/schemas/Currency"
          },
          "lastSync": {
            "type": "object",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/SyncRunSummary"
              }
            ]
          },
          "items": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "#/components/schemas/LatestPriceListItem"
            }
          }
        }
      },
      "PricePoint": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "price",
          "sourceUpdatedAt",
          "fetchedAt"
        ],
        "properties": {
          "price": {
            "$ref": "#/components/schemas/Decimal"
          },
          "sourceUpdatedAt": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "fetchedAt": {
            "$ref": "#/components/schemas/Timestamp"
          }
        }
      },
      "PriceHistoryPage": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "cryptocurrencyId",
          "currency",
          "items",
          "nextCursor"
        ],
        "properties": {
          "cryptocurrencyId": {
            "$ref": "#/components/schemas/Id"
          },
          "currency": {
            "$ref": "#/components/schemas/Currency"
          },
          "items": {
            "type": "array",
            "maxItems": 1000,
            "items": {
              "$ref": "#/components/schemas/PricePoint"
            }
          },
          "nextCursor": {
            "type": "string",
            "nullable": true,
            "description": "`null` — это последняя страница"
          }
        }
      },
      "AggregateStats": {
        "type": "object",
        "description": "`open`/`close`/`min`/`max` — реально наблюдённые цены (точно). `avg` — статистика, 10 значащих цифр (ADR 0007).\n`changePercent` = (close − open) / open × 100, 4 знака после запятой, HALF_EVEN.\n",
        "additionalProperties": false,
        "required": [
          "open",
          "close",
          "min",
          "max",
          "avg",
          "changePercent",
          "points"
        ],
        "properties": {
          "open": {
            "$ref": "#/components/schemas/Decimal"
          },
          "close": {
            "$ref": "#/components/schemas/Decimal"
          },
          "min": {
            "$ref": "#/components/schemas/Decimal"
          },
          "max": {
            "$ref": "#/components/schemas/Decimal"
          },
          "avg": {
            "$ref": "#/components/schemas/Decimal"
          },
          "changePercent": {
            "$ref": "#/components/schemas/SignedDecimal"
          },
          "points": {
            "type": "integer",
            "minimum": 1
          }
        }
      },
      "PriceBucket": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "bucketStart",
          "stats"
        ],
        "properties": {
          "bucketStart": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "stats": {
            "$ref": "#/components/schemas/AggregateStats"
          }
        }
      },
      "PriceAggregates": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "cryptocurrencyId",
          "currency",
          "interval",
          "from",
          "to",
          "summary",
          "buckets"
        ],
        "properties": {
          "cryptocurrencyId": {
            "$ref": "#/components/schemas/Id"
          },
          "currency": {
            "$ref": "#/components/schemas/Currency"
          },
          "interval": {
            "type": "string",
            "enum": [
              "1h",
              "4h",
              "1d",
              "1w"
            ]
          },
          "from": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "to": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "summary": {
            "type": "object",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/AggregateStats"
              }
            ],
            "description": "Сводка за весь период; `null`, если данных нет"
          },
          "buckets": {
            "type": "array",
            "maxItems": 1000,
            "items": {
              "$ref": "#/components/schemas/PriceBucket"
            }
          }
        }
      },
      "SparklinePoint": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "bucketStart",
          "close"
        ],
        "properties": {
          "bucketStart": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "close": {
            "$ref": "#/components/schemas/Decimal"
          }
        }
      },
      "Sparkline": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "cryptocurrencyId",
          "points"
        ],
        "properties": {
          "cryptocurrencyId": {
            "$ref": "#/components/schemas/Id"
          },
          "points": {
            "type": "array",
            "maxItems": 42,
            "items": {
              "$ref": "#/components/schemas/SparklinePoint"
            }
          }
        }
      },
      "SparklineList": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "currency",
          "window",
          "interval",
          "items"
        ],
        "properties": {
          "currency": {
            "$ref": "#/components/schemas/Currency"
          },
          "window": {
            "type": "string",
            "enum": [
              "24h",
              "7d"
            ]
          },
          "interval": {
            "type": "string",
            "enum": [
              "1h",
              "4h"
            ]
          },
          "items": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "#/components/schemas/Sparkline"
            }
          }
        }
      },
      "SyncRunStatus": {
        "type": "string",
        "enum": [
          "running",
          "succeeded",
          "partial",
          "failed",
          "interrupted"
        ]
      },
      "SyncRunSummary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "status",
          "finishedAt"
        ],
        "properties": {
          "id": {
            "$ref": "#/components/schemas/Id"
          },
          "status": {
            "$ref": "#/components/schemas/SyncRunStatus"
          },
          "finishedAt": {
            "type": "string",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/Timestamp"
              }
            ]
          }
        }
      },
      "SyncRun": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "trigger",
          "status",
          "startedAt",
          "finishedAt",
          "coinsRequested",
          "pricesSaved",
          "attempts",
          "creditsUsed",
          "error"
        ],
        "properties": {
          "id": {
            "$ref": "#/components/schemas/Id"
          },
          "trigger": {
            "type": "string",
            "enum": [
              "schedule",
              "manual",
              "startup"
            ]
          },
          "status": {
            "$ref": "#/components/schemas/SyncRunStatus"
          },
          "startedAt": {
            "$ref": "#/components/schemas/Timestamp"
          },
          "finishedAt": {
            "type": "string",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/Timestamp"
              }
            ]
          },
          "coinsRequested": {
            "type": "integer",
            "minimum": 0
          },
          "pricesSaved": {
            "type": "integer",
            "minimum": 0
          },
          "attempts": {
            "type": "integer",
            "minimum": 0
          },
          "creditsUsed": {
            "type": "integer",
            "minimum": 0,
            "nullable": true
          },
          "error": {
            "type": "object",
            "nullable": true,
            "additionalProperties": false,
            "required": [
              "code",
              "message"
            ],
            "properties": {
              "code": {
                "type": "string",
                "example": "CMC_TIMEOUT"
              },
              "message": {
                "type": "string"
              }
            }
          }
        }
      },
      "SyncRunPage": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "items",
          "nextCursor"
        ],
        "properties": {
          "items": {
            "type": "array",
            "maxItems": 1000,
            "items": {
              "$ref": "#/components/schemas/SyncRun"
            }
          },
          "nextCursor": {
            "type": "string",
            "nullable": true
          }
        }
      },
      "CmcStatus": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "lastSuccessAt",
          "lastError",
          "quota"
        ],
        "properties": {
          "lastSuccessAt": {
            "type": "string",
            "nullable": true,
            "allOf": [
              {
                "$ref": "#/components/schemas/Timestamp"
              }
            ]
          },
          "lastError": {
            "type": "object",
            "nullable": true,
            "additionalProperties": false,
            "required": [
              "code",
              "message",
              "at"
            ],
            "properties": {
              "code": {
                "type": "string",
                "example": "CMC_RATE_LIMITED"
              },
              "message": {
                "type": "string"
              },
              "at": {
                "$ref": "#/components/schemas/Timestamp"
              }
            }
          },
          "quota": {
            "type": "object",
            "nullable": true,
            "description": "`null`, если CMC `key/info` ещё ни разу не был получен",
            "additionalProperties": false,
            "required": [
              "creditLimitMonthly",
              "creditsUsedMonth",
              "creditsLeftMonth",
              "creditsUsedToday",
              "fetchedAt"
            ],
            "properties": {
              "creditLimitMonthly": {
                "type": "integer",
                "minimum": 0
              },
              "creditsUsedMonth": {
                "type": "integer",
                "minimum": 0
              },
              "creditsLeftMonth": {
                "type": "integer",
                "minimum": 0
              },
              "creditsUsedToday": {
                "type": "integer",
                "minimum": 0
              },
              "fetchedAt": {
                "$ref": "#/components/schemas/Timestamp"
              }
            }
          }
        }
      },
      "Problem": {
        "type": "object",
        "description": "RFC 9457 Problem Details. `errors` — только для validation-error.\n`conflictingId` — для already-tracked и sync-already-running: id существующего ресурса.\n",
        "additionalProperties": false,
        "required": [
          "type",
          "title",
          "status",
          "requestId"
        ],
        "properties": {
          "type": {
            "type": "string",
            "description": "Идентификатор типа ошибки (стабилен, на него можно завязываться в клиенте)",
            "enum": [
              "urn:cpt:problem:validation-error",
              "urn:cpt:problem:unauthorized",
              "urn:cpt:problem:forbidden",
              "urn:cpt:problem:not-found",
              "urn:cpt:problem:method-not-allowed",
              "urn:cpt:problem:already-tracked",
              "urn:cpt:problem:sync-already-running",
              "urn:cpt:problem:payload-too-large",
              "urn:cpt:problem:unsupported-media-type",
              "urn:cpt:problem:unknown-symbol",
              "urn:cpt:problem:watchlist-limit-reached",
              "urn:cpt:problem:upstream-unavailable",
              "urn:cpt:problem:internal-error"
            ]
          },
          "title": {
            "type": "string"
          },
          "status": {
            "type": "integer",
            "minimum": 400,
            "maximum": 599
          },
          "detail": {
            "type": "string"
          },
          "instance": {
            "type": "string",
            "description": "Путь запроса"
          },
          "requestId": {
            "type": "string"
          },
          "errors": {
            "type": "array",
            "description": "Только для validation-error",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "path",
                "message"
              ],
              "properties": {
                "path": {
                  "type": "string",
                  "example": "/query/limit"
                },
                "message": {
                  "type": "string"
                }
              }
            }
          },
          "conflictingId": {
            "$ref": "#/components/schemas/Id"
          }
        }
      }
    }
  }
};
