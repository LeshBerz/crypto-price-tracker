// Шаги гида — данные, а не разметка (ADR 0018): компонент `<GuidedTour>` один, туры различаются только этим файлом.
// Цель шага — элемент с атрибутом `data-tour="<target>"`; тест сверяет, что у каждой цели есть такой атрибут в коде.
import type { Role, TourId } from '@/lib/account/contract';

/** Тур экрана входа живёт вне учётной записи: до входа пользователя нет */
export type TourName = TourId | 'login';

export type TourIcon =
  | 'dashboard'
  | 'sync'
  | 'stream'
  | 'price'
  | 'change'
  | 'chart'
  | 'clock'
  | 'pause'
  | 'guide'
  | 'coin'
  | 'controls'
  | 'attribution'
  | 'summary'
  | 'history'
  | 'compass'
  | 'add'
  | 'warning'
  | 'offline'
  | 'delete'
  | 'activity'
  | 'quota'
  | 'health'
  | 'users'
  | 'lock'
  | 'shield';

export type TourStep = {
  /** Значение `data-tour` у элемента; на экране берётся первый видимый (таблица или карточки телефона) */
  target: string;
  icon: TourIcon;
  title: string;
  /** Абзацы текста */
  body: readonly string[];
  /** Откуда данные: операция api или маршрут web */
  api?: string;
  /** Что попробовать самому */
  hint?: string;
  /** Шаг показывается только этим ролям; без поля — всем */
  roles?: readonly Role[];
  /** Раздел, который нужно открыть перед шагом: гид оператора идёт по нескольким адресам */
  path?: string;
};

const WATCHLIST = '/operator/watchlist';
const SYNC = '/operator/sync';
const SYSTEM = '/operator/system';
const USERS = '/operator/users';

const dashboard = (role: Role): TourStep[] => [
  {
    target: 'logo',
    icon: 'dashboard',
    title: 'Добро пожаловать',
    body: [
      'Это дашборд: цены монет, которые отслеживает сервис. Нажатие на логотип всегда возвращает сюда.',
      role === 'operator'
        ? 'Рядом — панель оператора: watchlist, синхронизация, состояние системы и пользователи.'
        : 'Роль Viewer: доступны цены и графики. Состав watchlist меняет оператор.',
    ],
  },
  {
    target: 'sync-line',
    icon: 'sync',
    title: 'Когда обновлялись данные',
    body: [
      'Сервис забирает цены из CoinMarketCap фоном, по расписанию, и хранит их у себя. Здесь видно, когда прошла последняя синхронизация и чем закончилась.',
      ...(role === 'operator' ? ['Расписание и время следующего запуска — в разделе «Синхронизация».'] : []),
    ],
    api: 'listLatestPrices → lastSync',
  },
  {
    target: 'stream',
    icon: 'stream',
    title: 'Обновления в реальном времени',
    body: [
      'Новые цены приходят сами, перезагружать страницу не нужно. Если связь пропадёт, здесь появится «Переподключение…», а после него данные перечитаются.',
    ],
    api: 'SSE /api/stream: price.updated, sync.finished, watchlist.changed',
  },
  {
    target: 'price',
    icon: 'price',
    title: 'Точная цена',
    body: [
      'Цена приходит из API строкой и форматируется без перевода в число — ни одна цифра не теряется. Ведущие нули у мелких монет приглушены, чтобы значащие цифры читались сразу.',
    ],
    api: 'listLatestPrices → latest.price',
    hint: 'После гида нажмите на любую цену — «линза точности» покажет все знаки, которые прислал CoinMarketCap.',
  },
  {
    target: 'change',
    icon: 'change',
    title: 'Изменение за 24 часа',
    body: [
      'Стрелка, знак и цвет вместе — направление понятно и без цвета. Прочерк значит, что истории меньше суток: сервис копит её с момента добавления монеты.',
    ],
    api: 'latest.change24hPercent (строка; null → «—»)',
  },
  {
    target: 'sparkline',
    icon: 'chart',
    title: 'Мини-график',
    body: [
      'Цены закрытия по часам за сутки или по четыре часа за неделю — переключатель «24 ч / 7 д» над таблицей. Нажатие на символ монеты открывает полный график.',
    ],
    api: 'listSparklines?window=24h — один запрос на все монеты',
  },
  {
    target: 'updated',
    icon: 'clock',
    title: 'Свежесть',
    body: [
      'Сколько прошло с получения цены. Если новых цен нет дольше двух интервалов синхронизации, цена станет серой с пометкой «устарела», а сверху появится баннер. Данные при этом не пропадают.',
    ],
    api: 'latest.fetchedAt, latest.isStale',
  },
  {
    target: 'paused-tag',
    icon: 'pause',
    title: 'Монета на паузе',
    roles: ['operator'],
    body: [
      'Оператор может приостановить синхронизацию монеты, не удаляя историю: у такой монеты появляется метка «пауза».',
      'Её цена тоже стареет, но баннер на неё не реагирует: это решение, а не сбой.',
    ],
    api: 'listCryptocurrencies → isPaused',
  },
  {
    target: 'footer',
    icon: 'guide',
    title: 'Всё под рукой внизу',
    body: [
      'В футере — состояние системы, источник данных и версия контракта API. Там же ссылка «Пройти гид заново»; гид текущего экрана открывает кнопка «Гид» в шапке.',
    ],
  },
];

const coin = (): TourStep[] => [
  {
    target: 'coin-head',
    icon: 'coin',
    title: 'Карточка монеты',
    body: [
      'Символ, название, номер в CoinMarketCap и текущая цена с изменением за сутки. Цену можно нажать — линза покажет все знаки.',
    ],
    api: 'getCryptocurrency → latestPrice',
  },
  {
    target: 'coin-fresh',
    icon: 'clock',
    title: 'Два времени у одной цены',
    body: [
      '«Котировка CMC» — когда цену посчитал CoinMarketCap. «Обновлено» — когда её получил сервис. Разница обычно меньше минуты.',
    ],
    api: 'sourceUpdatedAt, fetchedAt',
  },
  {
    target: 'chart-controls',
    icon: 'controls',
    title: 'Вид, интервал и период',
    body: [
      'Свечи или линия, интервал свечи от часа до недели и период до года. Слишком подробные сочетания неактивны: «1 ч × 1 год» — это 8 760 свечей при лимите 1 000.',
    ],
    api: 'getPriceAggregates?interval&from&to',
  },
  {
    target: 'chart',
    icon: 'chart',
    title: 'График',
    body: [
      'Наведите курсор или поставьте фокус на график и листайте стрелками ← → — сверху появятся открытие, максимум, минимум и закрытие бакета.',
      'Часы без данных не дорисовываются: в свечах на их месте остаётся пропуск.',
    ],
    api: 'buckets[]: open, max, min, close, points',
  },
  {
    target: 'tv-attribution',
    icon: 'attribution',
    title: 'Атрибуция TradingView',
    body: [
      'График рисует библиотека TradingView Lightweight Charts. Её лицензия требует указать автора — поэтому значок на графике и ссылка в футере.',
    ],
  },
  {
    target: 'coin-summary',
    icon: 'summary',
    title: 'Сводка за период',
    body: [
      'Открытие, закрытие, минимум и максимум — наблюдённые цены без округления. Среднее — статистика, округлена до 10 значащих цифр.',
    ],
    api: 'getPriceAggregates → summary',
  },
  {
    target: 'coin-history',
    icon: 'history',
    title: 'История цен',
    body: ['Все сохранённые точки — от новых к старым. «Загрузить ещё» подгружает следующую страницу по курсору.'],
    api: 'listPriceHistory?limit&cursor → nextCursor',
  },
];

const operator = (): TourStep[] => [
  {
    path: WATCHLIST,
    target: 'operator-nav',
    icon: 'compass',
    title: 'Панель оператора',
    body: [
      'Четыре раздела: состав watchlist, запуски синхронизации, состояние интеграции с CoinMarketCap и пользователи.',
      'Viewer этих разделов не видит, а прямой переход по ссылке покажет «Недостаточно прав».',
    ],
  },
  {
    path: WATCHLIST,
    target: 'add-coin',
    icon: 'add',
    title: 'Добавить монету',
    body: [
      'Введите символ — сервис найдёт монету в CoinMarketCap и сам возьмёт название. Символы в CMC не уникальны: если нужна конкретная монета, укажите CMC ID в блоке «Дополнительно».',
    ],
    api: 'createCryptocurrency → 201 и уведомление с названием',
  },
  {
    path: WATCHLIST,
    target: 'add-coin-symbol',
    icon: 'warning',
    title: 'Если монету не добавить',
    body: [
      '409 — монета уже отслеживается: рядом с полем появится ссылка на её карточку.',
      '422 — символ не найден в CMC или достигнут лимит 100 монет. 400 — символ не по формату: латиница и цифры, до 15 знаков.',
    ],
    api: 'Problem Details (RFC 9457): already-tracked, unknown-symbol, watchlist-limit-reached',
  },
  {
    path: WATCHLIST,
    target: 'add-coin-submit',
    icon: 'offline',
    title: 'CoinMarketCap недоступен',
    body: [
      '503: без CMC символ не проверить, а непроверенные монеты не добавляются. Кнопка покажет обратный отсчёт из заголовка Retry-After.',
    ],
    api: 'upstream-unavailable + Retry-After',
  },
  {
    path: WATCHLIST,
    target: 'coin-pause',
    icon: 'pause',
    title: 'Пауза вместо удаления',
    body: [
      'Пауза останавливает синхронизацию монеты, но сохраняет историю. Дашборд пометит такую монету «пауза», без тревожного баннера.',
    ],
    api: 'updateCryptocurrency → isPaused',
  },
  {
    path: WATCHLIST,
    target: 'coin-delete',
    icon: 'delete',
    title: 'Удаление необратимо',
    body: [
      'Вместе с монетой удаляется вся история цен. Диалог покажет, сколько точек пропадёт, и попросит ввести символ. Там же есть «Поставить на паузу».',
    ],
    api: 'deleteCryptocurrency → 204',
  },
  {
    path: SYNC,
    target: 'sync-now',
    icon: 'sync',
    title: 'Синхронизировать сейчас',
    body: [
      'Сервер сразу отвечает 202, а запуск появляется в журнале со статусом «идёт». Завершение приходит событием — опрашивать не нужно.',
      'Если запуск уже идёт, ответ — 409 и переход к нему.',
    ],
    api: 'triggerSyncRun → 202 + Location; SSE sync.finished; 409 sync-already-running',
  },
  {
    path: SYNC,
    target: 'sync-runs',
    icon: 'activity',
    title: 'История запусков',
    body: [
      'У каждого запуска: чем он вызван, сколько цен сохранено, сколько было попыток, сколько потрачено кредитов CMC и код ошибки, если она была.',
    ],
    api: 'listSyncRuns?cursor',
  },
  {
    path: SYSTEM,
    target: 'system-tiles',
    icon: 'summary',
    title: 'Сначала итог',
    body: [
      'Три плитки отвечают на вопрос «всё ли в порядке?»: CoinMarketCap, квота на месяц и сам сервис. Подробности — ниже.',
    ],
    api: 'getCmcStatus, getReadiness',
  },
  {
    path: SYSTEM,
    target: 'system-quota',
    icon: 'quota',
    title: 'Квота и прогноз',
    body: [
      'Сколько кредитов CMC потрачено и хватит ли их до конца месяца при текущем расписании. Если нет — увеличьте интервал или уберите монеты.',
    ],
    api: 'getCmcStatus → quota, schedule',
  },
  {
    path: SYSTEM,
    target: 'system-health',
    icon: 'health',
    title: 'Здоровье сервиса',
    body: [
      'База и миграции в порядке — сервис готов принимать запросы. Доступность CoinMarketCap сюда намеренно не входит: при сбое источника сервис продолжает отдавать сохранённые данные.',
    ],
    api: 'getReadiness',
  },
  {
    path: USERS,
    target: 'users-create',
    icon: 'users',
    title: 'Пользователи и сессии',
    body: [
      'Регистрации нет: учётную запись создаёт оператор. Пароль создаёт сервер и показывает один раз — при первом входе пользователь обязан его сменить.',
      'Ниже — смена роли, отключение, сброс пароля и отзыв сессий. Эти данные живут в базе web и в api не уходят.',
    ],
    api: 'web: /api/admin/users, /api/admin/sessions',
  },
];

const login = (): TourStep[] => [
  {
    target: 'login-form',
    icon: 'lock',
    title: 'Вход по логину',
    body: [
      'Публичного дашборда нет: войти может только пользователь, которого создал оператор. После входа браузер получает защищённую cookie, а ключи API остаются на сервере.',
    ],
    api: 'web: POST /api/session',
  },
  {
    target: 'login-submit',
    icon: 'shield',
    title: 'Защита от подбора',
    body: [
      'При любой ошибке ответ один — «Неверный логин или пароль»: существующий логин не угадать. После пяти неудач перед следующей попыткой появляется растущая пауза, а учётная запись не блокируется.',
    ],
  },
  {
    target: 'login-no-signup',
    icon: 'users',
    title: 'Нет доступа?',
    body: ['Регистрации нет. Учётную запись создаёт, отключает и сбрасывает оператор в разделе «Пользователи».'],
  },
];

const TOURS: Record<TourName, (role: Role) => TourStep[]> = { dashboard, coin, operator, login };

/** Шаги тура для роли: шаги с `roles` показываются только перечисленным ролям */
export function stepsFor(tour: TourName, role: Role): TourStep[] {
  return TOURS[tour](role).filter((step) => !step.roles || step.roles.includes(role));
}
