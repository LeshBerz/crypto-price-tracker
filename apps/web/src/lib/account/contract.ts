// Контракт маршрутов `/api/admin/*` и `/api/me/*` (ADR 0016, поправка 28). Данные живут в web.db, в api эти
// запросы не ходят, потребитель один — сам web. Поэтому контракт — общие типы: их импортируют и обработчики
// маршрутов, и клиент, расхождение ловит компилятор. Ошибки — тот же RFC 9457, что у BFF (`urn:cpt:web:problem:*`).
// В файле только типы и константы: он попадает и в серверную, и в браузерную сборку.

import type { Role } from '@/server/users';

export type { Role };

export const ROLES: readonly Role[] = ['viewer', 'operator'];

/** Те же правила, что CHECK в схеме web.db и `LOGIN_FORMAT` на сервере */
export const LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;
/** NIST SP 800-63B: длина важнее состава (ADR 0016) */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Время — ISO 8601 в UTC, как в контракте api */
export type UserDto = {
  id: number;
  login: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Действующие сессии: не отозваны и не истекли */
  activeSessions: number;
};

export type SessionDto = {
  /** Открытый идентификатор: по нему сессию можно отозвать, но нельзя войти */
  id: string;
  userId: number;
  login: string;
  createdAt: string;
  lastSeenAt: string;
  /** Раньше из двух сроков: бездействие или абсолютный предел */
  expiresAt: string;
  /** `null` — web работает без доверенного прокси и адреса клиента не знает */
  ip: string | null;
  userAgent: string | null;
  /** Сессия, из которой пришёл этот запрос */
  isCurrent: boolean;
};

/** GET /api/admin/users */
export type UserList = { items: UserDto[] };

/** POST /api/admin/users → 201 */
export type CreateUserRequest = { login: string; role: Role };
/** Пароль создаёт сервер и отдаёт один раз: в БД остаётся только хэш */
export type CreateUserResponse = { user: UserDto; temporaryPassword: string };

/** PATCH /api/admin/users/{id}: хотя бы одно поле */
export type UpdateUserRequest = { role?: Role; isActive?: boolean };
export type UpdateUserResponse = { user: UserDto; revokedSessions: number };

/** POST /api/admin/users/{id}/password-reset */
export type ResetPasswordResponse = { user: UserDto; temporaryPassword: string; revokedSessions: number };

/** GET /api/admin/sessions и GET /api/me/sessions */
export type SessionList = { items: SessionDto[] };

/** GET /api/me/sessions */
export type Profile = { login: string; role: Role; lastLoginAt: string | null; sessions: SessionDto[] };

/** PUT /api/me/password → 204, все сессии пользователя отозваны */
export type ChangePasswordRequest = { currentPassword: string; newPassword: string };

/** Отказы, которые экран различает по `type` (без префикса `urn:cpt:web:problem:`) */
export type AccountProblem = 'login-taken' | 'last-operator' | 'own-password-reset' | 'invalid-current-password';
