// Watchlist оператора: проверка формы, ответы api → сообщения (ui-flows §3.5) и запись результата в кэш запросов.
// Чистые функции и работа с кэшем: сеть и React не участвуют, поэтому всё проверяется тестами напрямую.
import type { QueryClient } from '@tanstack/react-query';
import { BffError } from '@/lib/bff-client';
import { coinKeys, type Cryptocurrency } from '@/lib/coin/queries';
import { dashboardKeys, type CryptocurrencyList } from '@/lib/dashboard/queries';

/** Тот же шаблон, что `Symbol` в контракте api: расхождение дало бы 400 там, где форма ошибки не показала */
export const SYMBOL_PATTERN = /^[A-Z0-9]{1,15}$/;
export const NAME_MAX_LENGTH = 100;

export type AddFields = { symbol?: string; cmcId?: string };
export type AddRequest = { symbol: string; cmcId?: number };

/** Ввод формы → тело запроса или ошибки полей. Символ приводится к верхнему регистру, пустой CMC ID опускается */
export function parseAddForm(input: {
  symbol: string;
  cmcId: string;
}): { ok: true; request: AddRequest } | { ok: false; fields: AddFields } {
  const symbol = input.symbol.trim().toUpperCase();
  const rawId = input.cmcId.trim();
  const fields: AddFields = {};
  if (!SYMBOL_PATTERN.test(symbol)) fields.symbol = 'Только латинские буквы A–Z и цифры, от 1 до 15 символов';
  if (rawId !== '' && !/^[1-9]\d{0,8}$/.test(rawId)) fields.cmcId = 'CMC ID — целое положительное число';
  if (fields.symbol || fields.cmcId) return { ok: false, fields };
  return { ok: true, request: rawId === '' ? { symbol } : { symbol, cmcId: Number(rawId) } };
}

/** Имя для PATCH или текст ошибки. Правила — из контракта: 1–100 символов, не только пробелы */
export function parseName(input: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = input.trim();
  if (name === '') return { ok: false, message: 'Имя не может быть пустым' };
  if (name.length > NAME_MAX_LENGTH) return { ok: false, message: `Не длиннее ${NAME_MAX_LENGTH} символов` };
  return { ok: true, name };
}

export type FormAlert = { tone: 'warn' | 'error'; title: string; text: string };

export type AddFailure = {
  fields: AddFields;
  alert: FormAlert | null;
  /** 409: id монеты, которая уже отслеживается, — для ссылки на карточку */
  conflictingId: number | null;
  /** 503: через сколько секунд api советует повторить */
  retryAfterSeconds: number | null;
  requestId: string | null;
};

const DEFAULT_RETRY_SECONDS = 30;

/** Отказ api при добавлении монеты → что показать в форме. Таблица соответствий — ui-flows §3.5 */
export function describeAddFailure(error: unknown, request: AddRequest): AddFailure {
  const failure: AddFailure = {
    fields: {},
    alert: null,
    conflictingId: null,
    retryAfterSeconds: null,
    requestId: null,
  };
  if (!(error instanceof BffError)) {
    return { ...failure, alert: { tone: 'error', title: 'Монета не добавлена', text: 'Неизвестная ошибка.' } };
  }
  failure.requestId = error.requestId;
  const problem = error.problem;
  const slug = problem?.type.split(':').at(-1);

  if (error.source === 'network') {
    failure.alert = { tone: 'error', title: 'Нет связи с сервером', text: 'Проверьте подключение к сети и повторите.' };
  } else if (slug === 'validation-error') {
    for (const { path, message } of problem?.errors ?? []) {
      if (path === '/body/symbol') failure.fields.symbol = message;
      else if (path === '/body/cmcId') failure.fields.cmcId = message;
    }
    if (!failure.fields.symbol && !failure.fields.cmcId) {
      failure.alert = { tone: 'error', title: 'Запрос отклонён', text: problem?.detail ?? 'Проверьте поля формы.' };
    }
  } else if (slug === 'already-tracked') {
    failure.fields.symbol = `${request.symbol} уже отслеживается`;
    failure.conflictingId = problem?.conflictingId ?? null;
  } else if (slug === 'unknown-symbol') {
    failure.fields.symbol =
      request.cmcId === undefined
        ? `Символ «${request.symbol}» не найден в CoinMarketCap. Проверьте написание или укажите CMC ID в «Дополнительно».`
        : `Монета ${request.symbol} с CMC ID ${request.cmcId} не найдена в CoinMarketCap. Проверьте символ и ID.`;
  } else if (slug === 'watchlist-limit-reached') {
    failure.alert = {
      tone: 'warn',
      title: 'Достигнут лимит: 100 монет',
      text: 'Лимит связан с квотой CoinMarketCap. Удалите неиспользуемую монету, чтобы добавить новую.',
    };
  } else if (error.status === 503) {
    failure.retryAfterSeconds = error.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS;
    failure.alert = {
      tone: 'error',
      title: 'CoinMarketCap недоступен',
      text: 'Без него символ не проверить, а непроверенные монеты не добавляются.',
    };
  } else if (error.isUnavailable) {
    failure.alert = { tone: 'error', title: 'API не отвечает', text: 'Попробуйте ещё раз через минуту.' };
  } else if (error.status === 403) {
    failure.alert = { tone: 'error', title: 'Недостаточно прав', text: 'Добавлять монеты может только оператор.' };
  } else {
    failure.alert = {
      tone: 'error',
      title: 'Монета не добавлена',
      text: problem?.detail ?? problem?.title ?? `Ошибка ${error.status}.`,
    };
  }
  return failure;
}

/** Отказ api при переименовании, паузе, удалении и ручном запуске — одной строкой для уведомления */
export function describeFailure(error: unknown): string {
  if (!(error instanceof BffError)) return 'Неизвестная ошибка.';
  if (error.source === 'network') return 'Нет связи с сервером.';
  if (error.status === 404) return 'Монеты уже нет в списке: её удалили в другой вкладке.';
  if (error.status === 403) return 'Недостаточно прав.';
  if (error.isUnavailable) return 'API не отвечает. Попробуйте ещё раз через минуту.';
  const first = error.problem?.errors?.[0]?.message;
  return first ?? error.problem?.detail ?? error.problem?.title ?? `Ошибка ${error.status}.`;
}

/** Монета из ответа api — на своё место в списке; новая встаёт по символу, как сортирует api */
export function upsertCoin(list: CryptocurrencyList, coin: Cryptocurrency): CryptocurrencyList {
  const exists = list.items.some((item) => item.id === coin.id);
  const items = exists
    ? list.items.map((item) => (item.id === coin.id ? coin : item))
    : [...list.items, coin].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  return { ...list, items };
}

export function removeCoin(list: CryptocurrencyList, id: number): CryptocurrencyList {
  return { ...list, items: list.items.filter((item) => item.id !== id) };
}

/**
 * Успешный ответ на добавление, переименование или паузу → кэш. Обновление не оптимистичное: в кэш попадает
 * только то, что api уже сохранил и вернул (ui-flows §5). Событие `watchlist.changed` для этого не нужно —
 * поток может быть отключён; оно обновляет другие вкладки и другие экраны.
 *
 * Списки цен и мини-графики в ответе мутации не приходят: они помечаются устаревшими и перечитываются,
 * если сейчас на экране. Это запрос после действия пользователя, поэтому идёт обычным, а не фоновым путём.
 */
export function applyCoinSaved(queryClient: QueryClient, coin: Cryptocurrency): void {
  queryClient.setQueryData<CryptocurrencyList>(dashboardKeys.coins, (old) => old && upsertCoin(old, coin));
  queryClient.setQueryData(coinKeys.detail(coin.id), coin);
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.prices });
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.sparklinesAll });
}

/** Успешное удаление → строки нет в списке, данных карточки нет в кэше: api удалил монету вместе с историей */
export function applyCoinDeleted(queryClient: QueryClient, id: number): void {
  queryClient.setQueryData<CryptocurrencyList>(dashboardKeys.coins, (old) => old && removeCoin(old, id));
  queryClient.removeQueries({ queryKey: coinKeys.detail(id), exact: true });
  queryClient.removeQueries({ queryKey: coinKeys.aggregatesOf(id) });
  queryClient.removeQueries({ queryKey: coinKeys.history(id), exact: true });
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.prices });
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.sparklinesAll });
}
