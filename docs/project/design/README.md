# Дизайн `apps/web`

Статичные макеты будущего веб-клиента (фаза C, ROADMAP C1–C5). Кода приложения здесь нет. Макеты фиксируют, **что** и **из каких данных** показываем, до того как писать Next.js.

| Документ | Что внутри |
|---|---|
| [01-reference-analysis.md](01-reference-analysis.md) | Разбор CMC, CoinGecko, TradingView, Binance, Coinbase, Grafana, Stripe/Vercel. Свежесть и деградация, точные цены, realtime, WCAG 2.2. Итог «берём / не берём» и принципы дизайна |
| [mockups/](mockups/) | 4 самодостаточных HTML-макета |
| [ADR 0017](../../adr/0017-web-ui-data-gaps.md) (`Proposed`) | Два пробела контракта, найденные при сверке макетов |

Основа: [ui-flows.md](../ui-flows.md), [ADR 0012](../../adr/0012-web-charts-and-ui-kit.md), [ADR 0016](../../adr/0016-web-auth-and-bff-routes.md), [`openapi.yaml`](../../../apps/api/openapi/openapi.yaml).

## Как смотреть

Открыть файл из `mockups/` в браузере. Сервер и сеть не нужны.

- **Тема** — переключатель ☀ / ☾ / «Авто» в шапке. «Авто» следует `prefers-color-scheme`. Выбор запоминается в `localStorage`, а если хранилище недоступно, страница всё равно работает.
- **Состояния** — пунктирная «Панель макета» сверху. Это не часть интерфейса: она переключает сценарии ответа API. Нужный сценарий можно открыть и ссылкой с параметрами (таблица ниже).
- **Почему не Tailwind CDN.** Play CDN Tailwind 4 по документации [предназначен только для разработки](https://tailwindcss.com/docs/installation/play-cdn) и требует сети. Макеты написаны на CSS-переменных с именами токенов shadcn/ui (`--background`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--ring`) плюс доменные (`--up`, `--down`, `--stale`, `--warn-*`). В `apps/web` они переедут в `@theme` Tailwind 4 без переименования.
- Общий CSS и JS (форматирование, тема, шапка) **намеренно продублирован** в каждом файле: так каждый макет самодостаточен.

## Экраны

| Макет | Маршрут (ui-flows) | Роль | Сценарии (ссылки) |
|---|---|---|---|
| [login.html](mockups/login.html) | `/login` | — | [обычный](mockups/login.html) · [сессия завершена](mockups/login.html?reason=expired). В панели: неверный пароль, «слишком много попыток» с обратным отсчётом |
| [dashboard.html](mockups/dashboard.html) | `/` | Viewer, Operator | [норма](mockups/dashboard.html) · [деградация CMC](mockups/dashboard.html?scenario=degraded) · [деградация, Viewer](mockups/dashboard.html?scenario=degraded&role=viewer) · [синхронизация не удалась](mockups/dashboard.html?scenario=sync-failed) · [частичная](mockups/dashboard.html?scenario=partial) · [realtime оборван](mockups/dashboard.html?scenario=rt-offline) · [загрузка](mockups/dashboard.html?scenario=loading) · [ошибка](mockups/dashboard.html?scenario=error) · [пусто](mockups/dashboard.html?scenario=empty) |
| [coin.html](mockups/coin.html) | `/coins/[id]` | Viewer, Operator | [BTC, 1ч × 7д](mockups/coin.html) · [PEPE, 4ч × 30д](mockups/coin.html?id=7&interval=4h&period=30d) · [мало данных](mockups/coin.html?scenario=few) · [устарела](mockups/coin.html?scenario=stale) · [404](mockups/coin.html?scenario=notfound) |
| [operator.html](mockups/operator.html) | `/operator/watchlist`, `/sync`, `/system` | Operator | [watchlist](mockups/operator.html#watchlist) · [синхронизация](mockups/operator.html#sync) · [система](mockups/operator.html#system) · [CMC недоступен](mockups/operator.html?sys=down#system) · [квота на исходе](mockups/operator.html?sys=low#system) · [квота неизвестна](mockups/operator.html?sys=null#system) · [503 при добавлении](mockups/operator.html?add=503#watchlist) |

Вне макетов: `/profile` и `/operator/users` (ADR 0016) — это формы и таблицы на тех же компонентах. Алерты — v1.1.

## Что питает каждый элемент

Принцип 2 из аналитики: **на экране нет ничего, чего не отдаёт API.** Все операции api идут через BFF (`/api/bff/...`, ADR 0016). Сессии — маршруты самого web.

### Вход

| Элемент | Источник |
|---|---|
| Форма, «Неверный логин или пароль», «Слишком много попыток, N с» | `POST /api/session` (web, ADR 0016). Ответ один на все неудачи; задержка — прогрессивная |
| Баннер «Сессия завершена» | `?reason=expired` после 401 от BFF |

### Дашборд

| Элемент | Операция | Поля |
|---|---|---|
| Строки watchlist: символ, название | `listLatestPrices` | `items[].symbol`, `name`, `cryptocurrencyId` |
| Цена | `listLatestPrices` | `latest.price` (строка → `Intl.NumberFormat`), полное значение в `title` |
| «ожидает первой синхронизации» | `listLatestPrices` | `latest: null` |
| 24 ч: ▲/▼, знак, цвет; «—» | `listLatestPrices` | `latest.change24hPercent` (`null` → «—», «Истории меньше суток») |
| Мини-график 24 ч / 7 д | `listSparklines?window=24h\|7d` | `items[].points[].close` (`Number()` только для SVG) |
| «Обновлено 2 мин назад», подсказка | `listLatestPrices` | `latest.fetchedAt`, `latest.sourceUpdatedAt` |
| Метка «⚠ устарела», серая цена | `listLatestPrices` | `latest.isStale` |
| Метка «⏸ пауза», исключение из баннера | `listCryptocurrencies` | `items[].isPaused` — **ADR 0017, вариант 2B** |
| «Последняя синхронизация 14:05:00 · успешно» | `listLatestPrices` | `lastSync.finishedAt`, `lastSync.status` |
| «следующая ≈ 14:10» (только Operator) | `getCmcStatus` | `schedule.nextRunAt` — **ADR 0017, вариант 1D** (поля ещё нет) |
| Баннер деградации / частичной / неудачной синхронизации | вычисляется | `isStale` активных монет + `lastSync.status`. Время «последнего успешного обновления» — максимум `fetchedAt` |
| Подсветка ячейки цены | SSE `price.updated` | `cryptocurrencyId`, `price`, `fetchedAt` → `setQueryData(['prices'])` |
| Пересчёт `change24hPercent`, `isStale`, спарклайнов | SSE `sync.finished` | `invalidate(['prices'], ['sparklines'])` |
| Новые и удалённые строки | SSE `watchlist.changed` | `invalidate(['prices'], ['sparklines'], ['cryptocurrencies'])` |
| Индикатор «Онлайн / Переподключение…» | `EventSource` BFF `/api/stream` | состояние соединения; после переподключения — перезапрос REST |
| Карточка ошибки с `requestId` | любой 5xx | Problem `title`, `requestId` |

### Карточка монеты

| Элемент | Операция | Поля |
|---|---|---|
| Символ, название, CMC #, «отслеживается с» | `getCryptocurrency` | `symbol`, `name`, `cmcId`, `createdAt` |
| Крупная цена, 24 ч, свежесть, «устарела» | `getCryptocurrency` | `latestPrice.*` |
| Свечи / линия, правая шкала | `getPriceAggregates?interval&from` | `buckets[].stats.open/close/min/max`, `bucketStart` |
| Легенда OHLC по crosshair (мышь и ←/→) | там же | `stats.*`, `stats.changePercent`, `stats.points`. Для `1d` / `1w` — дата UTC (бакеты выровнены по UTC, ADR 0007) |
| Пустые промежутки | там же | отсутствующие бакеты не рисуются и не интерполируются |
| Неактивные сочетания интервала и периода | клиент | `(to − from) / interval > 1000` (ADR 0007) или меньше 2 бакетов — с объяснением |
| Сводка: открытие … точек | `getPriceAggregates` | `summary.*` (`avg` — 10 значащих цифр, ADR 0007) |
| «Данных пока мало» | `getPriceAggregates` | мало `summary.points` |
| История, «Загрузить ещё» | `listPriceHistory?limit&cursor` | `items[].price/fetchedAt/sourceUpdatedAt`, `nextCursor` |
| Обновление последней свечи | SSE `price.updated` | в `apps/web` — `series.update()` |
| «Монета не отслеживается» | `getCryptocurrency` 404 или `watchlist.changed: removed` | — |
| Логотип TV на графике и ссылка в футере | лицензия Lightweight Charts | `attributionLogo: true` |

### Панель оператора

| Элемент | Операция | Поля / ответы |
|---|---|---|
| Таблица монет: символ, название, CMC ID, статус, последняя цена, дата добавления | `listCryptocurrencies` | `symbol`, `name`, `cmcId`, `isPaused`, `lastUpdatedAt`, `createdAt` |
| Добавить: символ + «Дополнительно → CMC ID» | `createCryptocurrency` | 201 → тост с `name` и `cmcId` · 400 → ошибка у поля по `errors[].path` · 409 `already-tracked` → ссылка на `conflictingId` · 422 `unknown-symbol` · 422 `watchlist-limit-reached` · 503 + `Retry-After` → кнопка с обратным отсчётом |
| Пауза / Возобновить, Переименовать | `updateCryptocurrency` | `isPaused`, `name`. Без оптимистичного обновления (ui-flows §5) |
| Удалить: число точек, ввод символа, «Поставить на паузу» как альтернатива | `getPriceAggregates?interval=1w&from=createdAt` → `summary.points`, затем `deleteCryptocurrency` | 204. Число точек запрашивается **при открытии диалога**, а не для всей таблицы (иначе N+1) |
| Карточка «Сейчас» | `listSyncRuns` (первый) | `status`, `finishedAt`, `pricesSaved`, `coinsRequested` |
| «Следующий запуск», «каждые 5 мин» | `getCmcStatus` | `schedule.*` — **ADR 0017** |
| «Синхронизировать сейчас» | `triggerSyncRun` | 202 → строка `running`; завершение по SSE `sync.finished` без опроса · 409 → «уже идёт» + переход к `conflictingId` |
| Таблица запусков | `listSyncRuns?cursor` | `id`, `startedAt`, `finishedAt`, `trigger`, `status`, `pricesSaved`, `attempts`, `creditsUsed`, `error.code/message`, `nextCursor` |
| Плитки «CMC / Квота / Сервис» | `getCmcStatus`, `/health/ready` | итог сверху, детали ниже (принцип Grafana) |
| Интеграция CMC | `getCmcStatus` | `lastSuccessAt`, `lastError.code/message/at` |
| Квота: прогресс, сегодня, прогноз | `getCmcStatus` + `listSyncRuns` | `quota.*` (`null` → «ещё не получена»). Прогноз = средние `creditsUsed` за запуск × запусков в сутки (`schedule.intervalMs`, ADR 0017) × дней до конца месяца |
| Здоровье | `getReadiness` | `checks.database/migrations/scheduler` |

## Токены и контраст (WCAG 2.2 AA)

Контраст посчитан по формуле WCAG (относительная яркость) для итоговых значений токенов из макетов.

| Пара | Назначение | Светлая | Тёмная | Порог |
|---|---|---|---|---|
| `--foreground` / `--background` | текст | 17.85 ✅ | 15.77 ✅ | 4.5:1 |
| `--muted-foreground` / `--background` | вторичный текст | 6.39 ✅ | 7.63 ✅ | 4.5:1 |
| `--muted-foreground` / `--surface` | вторичный текст на подложке | 5.96 ✅ | 7.33 ✅ | 4.5:1 |
| `--up` / `--card` | рост | 5.48 ✅ | 9.33 ✅ | 4.5:1 |
| `--down` / `--card` | падение | 6.47 ✅ | 6.49 ✅ | 4.5:1 |
| `--up` / `--up-bg` | рост на подсветке | 4.92 ✅ | 7.98 ✅ | 4.5:1 |
| `--down` / `--down-bg` | падение на подсветке | 5.66 ✅ | 6.13 ✅ | 4.5:1 |
| `--stale` / `--card` | устаревшая цена | 5.88 ✅ | 5.94 ✅ | 4.5:1 |
| `--primary` / `--background` | ссылка | 6.70 ✅ | 8.04 ✅ | 4.5:1 |
| `--primary-foreground` / `--primary` | текст на основной кнопке | 6.70 ✅ | 8.04 ✅ | 4.5:1 |
| `--warn-fg` / `--warn-bg` | баннер деградации | 7.22 ✅ | 9.78 ✅ | 4.5:1 |
| `--info-fg` / `--info-bg` | инфо-баннер | 9.38 ✅ | 9.60 ✅ | 4.5:1 |
| `--down` / `--error-bg` | баннер ошибки | 5.91 ✅ | 6.35 ✅ | 4.5:1 |
| `--input` / `--card` | рамка поля (1.4.11) | 3.64 ✅ | 3.91 ✅ | 3:1 |
| `--ring` / `--background` | кольцо фокуса (1.4.11) | 6.70 ✅ | 8.04 ✅ | 3:1 |

Цвет нигде не единственный сигнал: у процентов есть знак и ▲/▼, у устаревшей цены — ⚠ и слово, у статусов — текст, у realtime — «Онлайн / Переподключение…».

## Как проверено

Headless Chrome через DevTools Protocol, 08.10.2026:

- **Ширина 320, 375 и 1280 px**, все 15 состояний из таблицы экранов (45 прогонов): горизонтальной прокрутки нет (WCAG 1.4.10), исключений JS и ошибок консоли нет. 320 px — в тёмной теме, 375 и 1280 — в светлой.
- **Сценарии взаимодействия** (все прошли):
  - дашборд: `price.updated` подсвечивает только ячейки цен; сортировка ставит `aria-sort`; переключение 24 ч / 7 д; переключатель темы пишет в `localStorage`;
  - карточка: 1ч × 1г неактивно с объяснением; 1д × 1г строит график; линия; перемещение crosshair стрелками; «Загрузить ещё»;
  - оператор: добавление 201 / 400 (клиентская проверка тем же паттерном) / 409 / 422 / 422 / 503 с обратным отсчётом; диалог удаления неактивен до ввода символа; пауза; ручная синхронизация `running → succeeded`;
  - вход: неверный пароль и «слишком много попыток».
- **Скриншоты** светлой и тёмной темы на десктопе и телефоне просмотрены глазами.
- `prettier --check` — чисто (CI проверяет `prettier --check .`).

## Отличия макетов от ui-flows.md

| ui-flows | В макетах | Почему |
|---|---|---|
| §3.2 «два запроса на весь дашборд» | три: + `listCryptocurrencies` | признак паузы (ADR 0017, 2B) |
| §3.2 «следующая ≈ 14:05» для всех | только Operator | Viewer не имеет `ops:read` (ADR 0017, 1D) |
| §3.2 баннер «недоступны с 14:05» | «последнее успешное обновление — 13:50» | начала сбоя в контракте нет, а время последней свежей цены есть (`fetchedAt`) |
| §3.2 баннер только по `isStale` | три уровня: info «синхронизация не удалась, цены свежие», warn «частично», warn «устарели» | `lastSync.status` уже в ответе; оператор видит проблему раньше, чем цены устареют |
| §3.5 таблица без числа точек | так и осталось; число точек — только в диалоге удаления | поля нет в `listCryptocurrencies` |
| §5 «тёмная по умолчанию» | «Авто» (системная) по умолчанию | вопрос Q1 |

## Открытые вопросы

Пачкой, с вариантами. Рекомендация выделена.

| # | Вопрос | Варианты | Рекомендация |
|---|---|---|---|
| **Q1** | Тема по умолчанию | а) тёмная (ui-flows §5) · б) **системная + переключатель** · в) светлая | **б.** Уважает настройку ОС; крипто-аудитория и так обычно в тёмной. Если важна «крипто-эстетика» на демо — а, тоже нормально |
| **Q2** | ADR 0017: расписание и пауза | а) **принять 1D + 2B** · б) 1A (убрать «следующий запуск» и прогноз квоты) + 2B · в) другое | **а.** Три поля в операционном эндпоинте и третий кэшируемый запрос. ТЗ-эндпоинты не трогаем |
| **Q3** | Формат мелких цен | а) как есть (`$0.0000123457`) · б) **приглушённые ведущие нули** · в) подстрочный счётчик `$0.0₄123457` | **б.** Число остаётся числом для копирования и скринридера, значащие цифры выделены |
| **Q4** | Локаль чисел | а) **en-US для денег** (`$67,123.45`), ru-RU для дат · б) ru-RU везде (`67 123,45 $`) | **а.** Так в ui-flows и у разобранных референсов (их английские версии). Как они выглядят в русской локали, **не проверял** |
| **Q5** | Как обновлять `change24hPercent` и `isStale` после realtime | а) **`invalidate(['prices'])` по `sync.finished`** (1 запрос в 5 мин) · б) считать на клиенте · в) добавить поля в `price.updated` (меняет контракт событий) | **а.** Формулы остаются на сервере, клиент их не дублирует |
| **Q6** | Подсветка изменившейся цены | а) **только ячейка, ≤ 1 с, в цвет направления, без анимации при `reduced-motion`** · б) без подсветки · в) вся строка | **а.** Пачка обновлений раз в 5 минут не превращает таблицу в «ёлку» |
| **Q7** | Таблица на телефоне | а) **карточки** · б) таблица с горизонтальной прокруткой | **а.** WCAG 1.4.10 и ни одной потерянной колонки |
| **Q8** | Значения по умолчанию на карточке | а) **свечи, 1ч × 7д** · б) линия, 1д × 30д | **а.** 168 бакетов — читаемо, и сразу видно, что данные копятся с часовой точностью |
| **Q9** | Даты дневных и недельных бакетов | а) **дата UTC с пометкой «UTC»** · б) локальное время начала («03:00» по Москве) | **а.** Бакеты выровнены по UTC (ADR 0007), а «03:00» путает |

## Что не удалось проверить

- **Настоящие компоненты не использовались.** График — SVG-имитация Lightweight Charts, диалоги — нативный `<dialog>`, а не Base UI. Поведение фокуса и шкал в `apps/web` будет от библиотек.
- **Скринридеры** (NVDA, VoiceOver) не прогонялись. Проверены только семантика и ARIA в разметке.
- **Браузеры** — только Chrome (headless, Windows). Firefox и Safari не проверялись. Форматирование строк через `Intl.NumberFormat` требует современного движка: MDN предупреждает, что старые реализации приводили строку к `Number`. Минимальные версии по браузерам **не проверял**.
- **Референсы** CoinGecko и Coinbase не открылись. Подробности — в [§6 аналитики](01-reference-analysis.md#6-что-не-удалось-проверить).
- **Попадают ли монеты на паузе в `listLatestPrices`** — хендлер ещё не написан. ADR 0017 (2B) работает при любом ответе.
