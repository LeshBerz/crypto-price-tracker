// Формы и сообщения экранов «Пользователи» и «Профиль»: проверка ввода до запроса, отказ сервера → текст для
// человека, строка User-Agent → «браузер · система». Чистые функции: проверяются тестами напрямую.
import { BffError } from '@/lib/bff-client';
import { plural } from '@/lib/format';
import { LOGIN_PATTERN, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type Role, type UserDto } from './contract';

export const ROLE_LABELS: Record<Role, string> = { viewer: 'Viewer', operator: 'Operator' };

export const ROLE_HINTS: Record<Role, string> = {
  viewer: 'Смотрит цены, графики и историю',
  operator: 'Дополнительно управляет watchlist, синхронизацией и пользователями',
};

const SESSIONS = ['сессия', 'сессии', 'сессий'] as const;

/** «3 сессии» */
export function countSessions(count: number): string {
  return `${count} ${plural(count, SESSIONS)}`;
}

/** Логин приводится к нижнему регистру, как на сервере: `Alice` и `alice` — один пользователь */
export function parseLogin(input: string): { ok: true; login: string } | { ok: false; message: string } {
  const login = input.trim().toLowerCase();
  if (!LOGIN_PATTERN.test(login)) {
    return { ok: false, message: 'От 3 до 32 символов: латинские буквы, цифры, точка, дефис, подчёркивание' };
  }
  return { ok: true, login };
}

export type PasswordFields = { currentPassword?: string; newPassword?: string; repeat?: string };

/** Форма смены пароля. Те же правила проверяет сервер: формы может и не быть */
export function parsePasswordForm(input: {
  currentPassword: string;
  newPassword: string;
  repeat: string;
}): { ok: true } | { ok: false; fields: PasswordFields } {
  const fields: PasswordFields = {};
  if (input.currentPassword === '') fields.currentPassword = 'Введите текущий пароль';
  if (input.newPassword.length < PASSWORD_MIN_LENGTH) {
    fields.newPassword = `Не короче ${PASSWORD_MIN_LENGTH} символов`;
  } else if (input.newPassword.length > PASSWORD_MAX_LENGTH) {
    fields.newPassword = `Не длиннее ${PASSWORD_MAX_LENGTH} символов`;
  } else if (input.newPassword === input.currentPassword) {
    fields.newPassword = 'Новый пароль совпадает с текущим';
  }
  if (!fields.newPassword && input.repeat !== input.newPassword) fields.repeat = 'Пароли не совпадают';
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true };
}

/** Имя отказа без префикса: `urn:cpt:web:problem:last-operator` → `last-operator` */
export function problemSlug(error: unknown): string | null {
  if (!(error instanceof BffError) || !error.problem) return null;
  return error.problem.type.replace(/^urn:cpt:(web:)?problem:/, '');
}

const FAILURES: Record<string, string> = {
  'login-taken': 'Такой логин уже есть. Выберите другой.',
  'last-operator': 'Это последний активный оператор. Сначала назначьте оператором другого пользователя.',
  'own-password-reset': 'Свой пароль меняется в профиле: для этого нужен текущий пароль.',
  'invalid-current-password': 'Текущий пароль указан неверно.',
  forbidden: 'Недостаточно прав для этого действия.',
  'forbidden-origin': 'Запрос отклонён: страница открыта с другого адреса. Обновите страницу.',
};

/** Отказ сервера → текст уведомления или формы */
export function describeAccountFailure(error: unknown): string {
  if (!(error instanceof BffError)) return 'Неизвестная ошибка.';
  if (error.source === 'network') return 'Нет связи с сервером. Изменение не сохранено.';
  if (error.status === 429) {
    const seconds = error.retryAfterSeconds;
    return seconds === null
      ? 'Слишком много попыток. Повторите позже.'
      : `Слишком много попыток. Повторите через ${seconds} с.`;
  }
  if (error.status === 404) return 'Запись не найдена: возможно, её уже изменили с другой вкладки. Список обновлён.';
  const slug = problemSlug(error);
  if (slug && FAILURES[slug]) return FAILURES[slug];
  return error.problem?.detail ?? error.problem?.title ?? `Ошибка ${error.status}.`;
}

/** Почему действие над пользователем недоступно; `null` — доступно. Решение принимает сервер, это подсказка */
export function lockReason(user: UserDto, users: readonly UserDto[]): string | null {
  const isActiveOperator = user.role === 'operator' && user.isActive;
  const operators = users.filter((item) => item.role === 'operator' && item.isActive).length;
  return isActiveOperator && operators <= 1 ? 'Последний активный оператор: его нельзя отключить или понизить' : null;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\/[\d.]+/, 'Edge'],
  [/\b(?:OPR|Opera)\/[\d.]+/, 'Opera'],
  [/\bYaBrowser\/[\d.]+/, 'Яндекс Браузер'],
  [/\bFirefox\/[\d.]+/, 'Firefox'],
  [/\b(?:Chrome|CriOS)\/[\d.]+/, 'Chrome'],
  [/\bSafari\/[\d.]+/, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/\bWindows\b/, 'Windows'],
  [/\bAndroid\b/, 'Android'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * Строка User-Agent → «Chrome · Windows». Порядок правил важен: Edge и Opera называют себя и Chrome тоже,
 * Chrome — и Safari. Это подпись для человека, а не определение возможностей браузера: незнакомая строка
 * показывается как есть (обрезанной), пустая — «неизвестно».
 */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent?.trim()) return 'неизвестно';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system ?? (userAgent.length > 40 ? `${userAgent.slice(0, 40)}…` : userAgent);
}
