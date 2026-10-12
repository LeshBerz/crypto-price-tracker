// Запросы экранов «Пользователи» и «Профиль» и запись результата мутаций в кэш. Событий потока по этим данным
// нет (они живут в web.db, а поток идёт из api), поэтому кэш меняется только из ответа мутации и повторным
// чтением того, чего в ответе нет. Чистые функции и работа с кэшем — проверяются тестами без React.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { AccountClient } from './client';
import type { Profile, SessionDto, SessionList, UserDto, UserList } from './contract';

export const accountKeys = {
  users: ['admin-users'] as const,
  sessions: ['admin-sessions'] as const,
  profile: ['profile'] as const,
};

export function usersQuery(client: AccountClient) {
  return queryOptions({ queryKey: accountKeys.users, queryFn: ({ signal }) => client.listUsers(signal) });
}

export function sessionsQuery(client: AccountClient) {
  return queryOptions({ queryKey: accountKeys.sessions, queryFn: ({ signal }) => client.listSessions(signal) });
}

export function profileQuery(client: AccountClient) {
  return queryOptions({ queryKey: accountKeys.profile, queryFn: ({ signal }) => client.profile(signal) });
}

/** Пользователь встаёт по логину — так сортирует сервер; существующий заменяется на месте */
export function upsertUser(list: UserList, user: UserDto): UserList {
  const items = list.items.some((item) => item.id === user.id)
    ? list.items.map((item) => (item.id === user.id ? user : item))
    : [...list.items, user].sort((a, b) => (a.login < b.login ? -1 : a.login > b.login ? 1 : 0));
  return { items };
}

export function removeSession(sessions: readonly SessionDto[], id: string): SessionDto[] {
  return sessions.filter((session) => session.id !== id);
}

/**
 * Ответ на создание, смену роли, отключение или сброс пароля → кэш. Пользователь берётся из ответа сервера.
 * Список сессий в ответе не приходит: если действие отозвало сессии, он помечается устаревшим и перечитывается.
 */
export function applyUserSaved(queryClient: QueryClient, user: UserDto, revokedSessions = 0): void {
  queryClient.setQueryData<UserList>(accountKeys.users, (old) => old && upsertUser(old, user));
  if (revokedSessions > 0) void queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
}

/**
 * Оператор отозвал сессию (ответ 204, тела нет) → строки нет в списке. Счётчик «активных сессий» у пользователя
 * в ответе не приходит, поэтому список пользователей перечитывается, а не правится догадкой.
 */
export function applySessionRevoked(queryClient: QueryClient, id: string): void {
  queryClient.setQueryData<SessionList>(accountKeys.sessions, (old) => old && { items: removeSession(old.items, id) });
  void queryClient.invalidateQueries({ queryKey: accountKeys.users });
}

/** Пользователь завершил одну из своих сессий → её нет в профиле */
export function applyOwnSessionRevoked(queryClient: QueryClient, id: string): void {
  queryClient.setQueryData<Profile>(
    accountKeys.profile,
    (old) => old && { ...old, sessions: removeSession(old.sessions, id) },
  );
}

/**
 * Отказ действия отзыва: список мог устареть (сессия истекла или её уже отозвали с другой вкладки) —
 * перечитывается всё, что экран показывает.
 */
export function refreshAccount(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: accountKeys.users });
  void queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
  void queryClient.invalidateQueries({ queryKey: accountKeys.profile });
}
