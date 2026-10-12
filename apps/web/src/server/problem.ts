// Ответы маршрутов web: JSON и ошибки в формате RFC 9457 — том же, что у api (ADR 0016, поправка 6).

export type ProblemSlug =
  | 'validation-error'
  | 'unsupported-media-type'
  | 'forbidden-origin'
  | 'invalid-credentials'
  | 'too-many-attempts'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'payload-too-large'
  | 'upstream-unavailable'
  | 'upstream-timeout'
  | 'upstream-rejected-key'
  | 'login-taken'
  | 'last-operator'
  | 'own-password-reset'
  | 'invalid-current-password';

const TITLES: Record<ProblemSlug, string> = {
  'validation-error': 'Некорректный запрос',
  'unsupported-media-type': 'Ожидается application/json',
  'forbidden-origin': 'Запрос с другого сайта отклонён',
  'invalid-credentials': 'Неверный логин или пароль',
  'too-many-attempts': 'Слишком много попыток входа',
  unauthorized: 'Требуется вход',
  forbidden: 'Недостаточно прав',
  'not-found': 'Не найдено',
  'payload-too-large': 'Тело запроса слишком большое',
  'upstream-unavailable': 'Сервис данных недоступен',
  'upstream-timeout': 'Сервис данных не ответил вовремя',
  'upstream-rejected-key': 'Сервис данных отклонил ключ веб-клиента',
  'login-taken': 'Логин уже занят',
  'last-operator': 'Нельзя оставить систему без оператора',
  'own-password-reset': 'Свой пароль меняется в профиле',
  'invalid-current-password': 'Текущий пароль указан неверно',
};

/** Клиентский код разбирает ответы BFF и api одинаково: type, title, status и дополнительные поля */
export function problem(
  status: number,
  slug: ProblemSlug,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ type: `urn:cpt:web:problem:${slug}`, title: TITLES[slug], status, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/problem+json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
