// Клиент маршрутов пользователей и сессий (`/api/admin/*`, `/api/me/*`). Отдельный от клиента BFF: тот типизирован
// сгенерированным контрактом api, а эти маршруты в api не ходят — их типы лежат в `./contract` и общие с сервером.
// Разбор ответов и ошибок — тот же (`createJsonRequest`): формат Problem у всех маршрутов web один.
import { browserDeps, createJsonRequest, type BffClientDeps } from '@/lib/bff-client';
import type {
  ChangePasswordRequest,
  CreateUserRequest,
  CreateUserResponse,
  Profile,
  ResetPasswordResponse,
  SessionList,
  TourId,
  UpdateUserRequest,
  UpdateUserResponse,
  UserList,
} from './contract';

export type AccountClient = {
  listUsers(signal?: AbortSignal): Promise<UserList>;
  createUser(body: CreateUserRequest): Promise<CreateUserResponse>;
  updateUser(id: number, body: UpdateUserRequest): Promise<UpdateUserResponse>;
  resetPassword(id: number): Promise<ResetPasswordResponse>;
  listSessions(signal?: AbortSignal): Promise<SessionList>;
  revokeSession(id: string): Promise<void>;
  profile(signal?: AbortSignal): Promise<Profile>;
  revokeOwnSession(id: string): Promise<void>;
  logoutEverywhere(): Promise<void>;
  changePassword(body: ChangePasswordRequest): Promise<void>;
  completeTour(tour: TourId): Promise<void>;
  resetTours(): Promise<void>;
};

const ACCEPT = { accept: 'application/json' };
/** Content-Type: application/json — слой защиты от CSRF (ADR 0016): сервер требует его и у POST без тела */
const JSON_HEADERS = { ...ACCEPT, 'content-type': 'application/json' };

export function createAccountClient(deps: BffClientDeps): AccountClient {
  const request = createJsonRequest(deps);
  const read = <T>(url: string, signal?: AbortSignal) => request<T>(url, { method: 'GET', headers: ACCEPT, signal });
  const write = <T>(method: string, url: string, body?: unknown) =>
    request<T>(url, { method, headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  const remove = (url: string) => request<undefined>(url, { method: 'DELETE', headers: ACCEPT });

  return {
    listUsers: (signal) => read('/api/admin/users', signal),
    createUser: (body) => write('POST', '/api/admin/users', body),
    updateUser: (id, body) => write('PATCH', `/api/admin/users/${id}`, body),
    resetPassword: (id) => write('POST', `/api/admin/users/${id}/password-reset`),
    listSessions: (signal) => read('/api/admin/sessions', signal),
    revokeSession: (id) => remove(`/api/admin/sessions/${encodeURIComponent(id)}`),
    profile: (signal) => read('/api/me/sessions', signal),
    revokeOwnSession: (id) => remove(`/api/me/sessions/${encodeURIComponent(id)}`),
    logoutEverywhere: () => remove('/api/me/sessions'),
    changePassword: (body) => write('PUT', '/api/me/password', body),
    completeTour: (tour) => write('PUT', `/api/me/tours/${tour}`),
    resetTours: () => remove('/api/me/tours'),
  };
}

/** Клиент для компонентов. В тестах создаётся свой — с подставным fetch */
export const account: AccountClient = createAccountClient(browserDeps);
