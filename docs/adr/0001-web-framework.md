# 0001. Фреймворк для `apps/web`: Next.js или React (Vite)

- **Статус:** Accepted (06.10.2026)
- **Дата:** 06.10.2026
- **Вопрос брифа:** Q1
- **Связано:** [0002 — модель доступа](0002-access-model.md)

## Контекст

`apps/web` — бонусное приложение: дашборд (Viewer) и панель оператора (Operator). На сдачу не влияет, ограничения C7 на него не распространяются. Работает только локально через `docker compose`, деплоя нет.

Что важно для решения:

| Фактор | Что из него следует |
|---|---|
| Дашборд за логином, SEO не нужен | SSR как средство для SEO ничего не даёт |
| Ключ к `apps/api` нельзя отдавать в браузер (дух C4, см. 0002) | Нужен серверный слой между браузером и api — **BFF** |
| Realtime через SSE | Браузерный `EventSource` **не умеет** ставить заголовок `Authorization` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials)). Значит, либо ключ в query string (утечёт в логи), либо cookie того же origin → снова BFF |
| Цель — портфолио фуллстека | Важен спрос на рынке и в Evercode |
| Срок — 1,5 дня (фаза C) | Важна скорость и знакомость стека |

## Варианты

1. **Next.js 16 (App Router)** — фреймворк с серверной частью: Route Handlers работают как BFF, cookie-сессия, прокси SSE.
2. **React + Vite (SPA)** + отдельный маленький BFF-сервер (Express/Fastify) — два процесса в `apps/web`.
3. **React + Vite (SPA) без BFF** — браузер ходит в api напрямую с ключом.

## Сравнение

| Критерий | Next.js 16 | Vite SPA + свой BFF | Vite SPA без BFF |
|---|---|---|---|
| BFF «из коробки» | ✅ Route Handlers | 🟡 пишем сами | ❌ |
| Ключ api не попадает в браузер | ✅ | ✅ | ❌ ключ в JS-бандле или localStorage |
| SSE с авторизацией | ✅ через cookie, прокси стрима | ✅ | ❌ ключ в URL |
| Число процессов и Dockerfile | 1 | 2 | 1 (nginx) |
| Сложность ментальной модели | 🟡 server/client components, кэширование | ✅ привычный React + Express | ✅ самая простая |
| Скорость dev-сборки | 🟡 Turbopack, но тяжелее | ✅ Vite — эталон | ✅ |
| Спрос на рынке | ✅ самый используемый метафреймворк | 🟡 React — да, связка — нишевая | 🟡 |
| Удовлетворённость разработчиков | 🟡 падает | ✅ Vite — 98 % | ✅ |

### Данные рынка

- **Stack Overflow Survey 2025:** React — 44,7 % использования, Next.js — около 20 % (рост с 17 %). Но admiration у Next.js упал с 50 до 45 % ([разбор](https://pagepro.co/blog/react-tldr/stack-overflow-2025-react-and-next-js-grow-in-use-drop-in-admiration/)).
- **State of JS 2025:** Next.js — лидер по использованию, но по retention почти на последнем месте. Vite почти догнал webpack по использованию, satisfaction 98 % ([InfoQ](https://www.infoq.com/news/2026/03/state-of-js-survey-2025), [Strapi](https://strapi.io/blog/state-of-javascript-2025-key-takeaways)).
- **Команда React** в феврале 2025 закрыла Create React App и рекомендует для новых приложений фреймворк, а Vite — когда фреймворк не подходит ([react.dev](https://react.dev/blog/2025/02/14/sunsetting-create-react-app)).
- **Evercode Lab:** в вакансии Frontend (React) Next.js указан как плюс ([Хабр Карьера](https://career.habr.com/vacancies/1000098014)). Есть вакансия Fullstack JS ([Хабр Карьера](https://career.habr.com/vacancies/1000158148)).
- **Next.js 16** — LTS до 21.10.2027, Turbopack по умолчанию ([nextjs.org/blog](https://nextjs.org/blog)).

Вывод из рынка: Next.js — самый востребованный, но не самый любимый. Vite любят больше. Для портфолио к вакансии Evercode Next.js весит больше.

## Решение (рекомендация)

**Next.js 16 (App Router, TypeScript) в роли «React-дашборд + BFF».**

Правила, чтобы не утонуть в сложности:
- Страницы — в основном **client components** (графики, realtime). Server components — только для загрузки первичных данных.
- Вся связь с `apps/api` идёт **только с сервера Next** (Route Handlers в `app/api/*` и серверный код). В браузер не уходит ни ключ, ни адрес api.
- SSE: браузер подписывается на `/api/stream` в Next (cookie-сессия), Next проксирует поток из `apps/api` со своим ключом.
- Server Actions и продвинутое кэширование (`use cache`, PPR) не используем: на интервью их придётся защищать, а пользы для дашборда мало.

Почему не Vite SPA + свой BFF: технически это равноценно, но выйдет два процесса и больше ручной работы за те же 1,5 дня. Выигрыш — только в простоте React-части.

## Последствия

- ➕ BFF и защита ключа без отдельного сервиса. Закрывает проблему SSE + Bearer.
- ➕ Стек совпадает с плюсом в вакансии Evercode. Хорошая история «зачем мне тут сервер у фронта».
- ➖ Порог входа App Router: нужно понимать границу server/client. Риск для сроков фазы C → держим правила выше.
- ➖ Тяжелее Docker-образ и сборка, чем у статики на nginx. Для локального запуска некритично. Используем `output: 'standalone'`.
- Открыто до фазы C: UI-кит и графики (Q11), хранилище пользователей web (см. 0002).

## Как защищать на интервью

«Дашборд не нужен поисковикам, поэтому SSR ради SEO мне ни к чему. Next.js я взял как **BFF**: ключ к API живёт только на сервере, браузер ходит с httpOnly-cookie. Заодно решается проблема `EventSource` без заголовков. Если бы BFF был не нужен, выбрал бы Vite».
