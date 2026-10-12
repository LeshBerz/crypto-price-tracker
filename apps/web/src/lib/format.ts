// Форматирование для экрана. Цены и проценты приходят строками (тип Decimal контракта) и в `number` не
// переводятся: Intl.NumberFormat принимает десятичную строку и форматирует её точно (ADR 0006, 0012).

type Numeric = Intl.StringNumericLiteral;

/** Деньги — в локали en-US (`$67,123.45`), даты и время — в ru-RU: решение Q4 дизайна */
const usdFixed = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdSignificant = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 6,
});
const percent = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const clockSeconds = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Цена: от 1 — два знака после запятой, меньше 1 — шесть значащих цифр. Decimal контракта не имеет ведущих
 * нулей, кроме самого `0`, поэтому «меньше 1» равносильно «начинается с 0».
 */
export function formatPrice(price: string): string {
  if (!price.startsWith('0')) return usdFixed.format(price as Numeric);
  // Значащие цифры отбрасывают хвостовые нули: `$0.5`. Для денег дробная часть дополняется до двух знаков
  const [whole = '', fraction = ''] = usdSignificant.format(price as Numeric).split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

/**
 * Подпись шкалы цен графика. Единственный формат, принимающий `number`: шкалу рисует библиотека графика
 * по координатам, исходной строки у деления шкалы нет (ADR 0012). Правила те же, что у `formatPrice`.
 */
export function formatAxisPrice(value: number): string {
  if (Math.abs(value) >= 1) return usdFixed.format(value);
  const [whole = '', fraction = ''] = usdSignificant.format(value).split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export type PriceParts = { head: string; zeros: string; tail: string };

/**
 * Мелкая цена делится на части, чтобы приглушить ведущие нули: `$0.` + `0000` + `123457` (решение Q3 дизайна).
 * Текст остаётся обычным числом — для копирования и скринридера. Меньше трёх нулей — приглушать нечего.
 */
export function splitPrice(formatted: string): PriceParts {
  const match = /^(\$0\.)(0{3,})(\d+)$/.exec(formatted);
  if (!match) return { head: formatted, zeros: '', tail: '' };
  return { head: match[1] ?? '', zeros: match[2] ?? '', tail: match[3] ?? '' };
}

export type Direction = 'up' | 'down' | 'flat';

/** Изменение в процентах: знак показывается всегда, минус — типографский. Направление — по округлённому значению */
export function formatChange(change: string): { text: string; direction: Direction } {
  const text = `${percent.format(change as Numeric).replace('-', '−')}%`;
  const direction = text.startsWith('+') ? 'up' : text.startsWith('−') ? 'down' : 'flat';
  return { text, direction };
}

/**
 * Сравнение двух Decimal контракта (неотрицательные, без ведущих нулей) без перевода в number: сначала длина
 * целой части, затем посимвольно. Нужно только для направления подсветки изменившейся цены.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const [aInt = '', aFrac = ''] = a.split('.');
  const [bInt = '', bFrac = ''] = b.split('.');
  if (aInt.length !== bInt.length) return aInt.length < bInt.length ? -1 : 1;
  if (aInt !== bInt) return aInt < bInt ? -1 : 1;
  const width = Math.max(aFrac.length, bFrac.length);
  const left = aFrac.padEnd(width, '0');
  const right = bFrac.padEnd(width, '0');
  return left === right ? 0 : left < right ? -1 : 1;
}

export function formatClock(iso: string, { seconds = false }: { seconds?: boolean } = {}): string {
  return (seconds ? clockSeconds : clock).format(Date.parse(iso));
}

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateTimeSeconds = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Дата и время в часовом поясе браузера: `12.10.2026, 15:04` */
export function formatDateTime(time: string | number, { seconds = false }: { seconds?: boolean } = {}): string {
  return (seconds ? dateTimeSeconds : dateTime).format(typeof time === 'string' ? Date.parse(time) : time);
}

const dateTimeUtc = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** Начало бакета графика: бакеты выровнены по UTC, поэтому и подписаны в UTC — `12.10.2026, 14:00 UTC` */
export function formatUtc(time: number): string {
  return `${dateTimeUtc.format(time)} UTC`;
}

export function formatDate(time: string | number): string {
  return dateOnly.format(typeof time === 'string' ? Date.parse(time) : time);
}

/** «2 мин назад» относительно `now`. Время из будущего (расхождение часов) показывается как «только что» */
export function formatRelative(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

const PLURAL = new Intl.PluralRules('ru-RU');

/** Склонение: plural(5, ['монета', 'монеты', 'монет']) → «монет» */
export function plural(count: number, [one, few, many]: readonly [string, string, string]): string {
  const rule = PLURAL.select(count);
  return rule === 'one' ? one : rule === 'few' ? few : many;
}
