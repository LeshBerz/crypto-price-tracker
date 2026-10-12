// HTTP-обработчики /api/admin/* и /api/me/* (ADR 0016) на стандартных Request и Response: тестируются без Next.
// Данные — в web.db, в api эти маршруты не ходят. Порядок проверок тот же, что у BFF: сессия → роль → CSRF → тело.
// Аналог в Nest — контроллер с AuthGuard и RolesGuard; здесь охрана — функция `enter` в начале обработчика.
import type {
  ChangePasswordRequest,
  CreateUserRequest,
  CreateUserResponse,
  Profile,
  ResetPasswordResponse,
  SessionDto,
  SessionList,
  UpdateUserRequest,
  UpdateUserResponse,
  UserDto,
  UserList,
} from '@/lib/account/contract';
import { TOUR_ROLE } from '@/lib/account/contract';
import { hasRole } from './bff/allowlist';
import type { Services } from './container';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './passwords';
import { json, problem } from './problem';
import {
  clearSessionCookie,
  clientIp,
  isJsonRequest,
  isSameOrigin,
  isSecureRequest,
  readSessionToken,
} from './request';
import { SESSION_ID_FORMAT, type Session, type SessionInfo } from './sessions';
import { isTourId } from './tours';
import { isUserAdminError } from './user-admin';
import type { Role, UserSummary } from './users';

/** Тела этих маршрутов — два-три коротких поля */
const MAX_BODY_BYTES = 4 * 1024;

type Guard = {
  role?: Role;
  /** Мутация: Origin обязан совпадать с адресом web */
  write?: boolean;
  /** Мутация с телом: Content-Type обязан быть application/json */
  body?: boolean;
  /** Маршрут открыт и с временным паролем: только сама смена пароля */
  temporaryPassword?: boolean;
};

/**
 * 401 раньше 403: без сессии нельзя узнать, какие маршруты существуют. CSRF проверяется после роли —
 * тот же порядок, что у BFF (ADR 0016, поправка 14).
 */
function enter(request: Request, services: Services, guard: Guard = {}): Session | Response {
  const session = services.sessions.validate(readSessionToken(request));
  if (!session) return problem(401, 'unauthorized');
  // С временным паролем сессия годится только для его смены: ни данных, ни управления (поправка 35)
  if (session.mustChangePassword && !guard.temporaryPassword) return problem(403, 'password-change-required');
  if (guard.role && !hasRole(session.role, guard.role)) return problem(403, 'forbidden');
  if (guard.body && !isJsonRequest(request)) return problem(415, 'unsupported-media-type');
  if (guard.write && !isSameOrigin(request, services.config.trustProxy)) return problem(403, 'forbidden-origin');
  return session;
}

/** JSON-объект с полями только из списка. Лишнее поле — 400, как в api: опечатка в имени не проходит молча */
async function readObject(request: Request, allowed: readonly string[]): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null;
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  return Object.keys(body).every((key) => allowed.includes(key)) ? (body as Record<string, unknown>) : null;
}

function invalid(detail: string): Response {
  return problem(400, 'validation-error', { detail });
}

function isRole(value: unknown): value is Role {
  return value === 'viewer' || value === 'operator';
}

/** Идентификатор пользователя из пути: целое положительное число без ведущих нулей */
function parseUserId(raw: string): number | null {
  return /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null;
}

const iso = (time: number) => new Date(time).toISOString();

function toUserDto(user: UserSummary): UserDto {
  return {
    id: user.id,
    login: user.login,
    role: user.role,
    isActive: user.isActive,
    createdAt: iso(user.createdAt),
    lastLoginAt: user.lastLoginAt === null ? null : iso(user.lastLoginAt),
    activeSessions: user.activeSessions,
    mustChangePassword: user.mustChangePassword,
  };
}

/** `tokenHash` в ответ не попадает: по нему только помечается текущая сессия */
function toSessionDto(info: SessionInfo, current: Session): SessionDto {
  return {
    id: info.id,
    userId: info.userId,
    login: info.login,
    createdAt: iso(info.createdAt),
    lastSeenAt: iso(info.lastSeenAt),
    expiresAt: iso(info.expiresAt),
    ip: info.ip,
    userAgent: info.userAgent,
    isCurrent: info.tokenHash === current.tokenHash,
  };
}

/** Доменная ошибка → Problem Details; остальное летит дальше и станет 500 */
function fromAdminError(error: unknown): Response {
  if (!isUserAdminError(error)) throw error;
  const extra = { detail: error.message };
  if (error.kind === 'invalid-login') return problem(400, 'validation-error', extra);
  if (error.kind === 'not-found') return problem(404, 'not-found', extra);
  return problem(409, error.kind, extra);
}

function signedOut(request: Request, services: Services): Response {
  const secure = isSecureRequest(request, services.config.trustProxy);
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie(secure), 'Cache-Control': 'no-store' },
  });
}

const NO_CONTENT = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

// ───────────────────────────── /api/admin/users ─────────────────────────────

export function handleListUsers(request: Request, services: Services): Response {
  const session = enter(request, services, { role: 'operator' });
  if (session instanceof Response) return session;
  return json(200, { items: services.userAdmin.list().map(toUserDto) } satisfies UserList);
}

export async function handleCreateUser(request: Request, services: Services): Promise<Response> {
  const session = enter(request, services, { role: 'operator', write: true, body: true });
  if (session instanceof Response) return session;
  const body = await readObject(request, ['login', 'role'] satisfies (keyof CreateUserRequest)[]);
  if (!body || typeof body.login !== 'string' || body.login.length > 256 || !isRole(body.role)) {
    return invalid('Нужны поля login (строка) и role (viewer или operator)');
  }
  try {
    const created = await services.userAdmin.create(body.login, body.role);
    const response: CreateUserResponse = {
      user: toUserDto(created.user),
      temporaryPassword: created.temporaryPassword,
    };
    services.log('info', 'user created', { by: session.login, login: created.user.login, role: created.user.role });
    return json(201, response);
  } catch (error) {
    return fromAdminError(error);
  }
}

export async function handleUpdateUser(request: Request, services: Services, rawId: string): Promise<Response> {
  const session = enter(request, services, { role: 'operator', write: true, body: true });
  if (session instanceof Response) return session;
  const id = parseUserId(rawId);
  if (id === null) return problem(404, 'not-found');
  const body = await readObject(request, ['role', 'isActive'] satisfies (keyof UpdateUserRequest)[]);
  if (!body || (body.role === undefined && body.isActive === undefined)) {
    return invalid('Нужно хотя бы одно поле: role (viewer или operator) или isActive (true или false)');
  }
  if (body.role !== undefined && !isRole(body.role)) return invalid('role — viewer или operator');
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') return invalid('isActive — true или false');
  try {
    const result = services.userAdmin.update(id, { role: body.role, isActive: body.isActive });
    services.log('info', 'user updated', {
      by: session.login,
      login: result.user.login,
      role: result.user.role,
      isActive: result.user.isActive,
      revokedSessions: result.revokedSessions,
    });
    const response: UpdateUserResponse = { user: toUserDto(result.user), revokedSessions: result.revokedSessions };
    return json(200, response);
  } catch (error) {
    return fromAdminError(error);
  }
}

export async function handleResetPassword(request: Request, services: Services, rawId: string): Promise<Response> {
  // Тела нет, но Content-Type: application/json обязателен — HTML-форма с чужого сайта его не отправит
  const session = enter(request, services, { role: 'operator', write: true, body: true });
  if (session instanceof Response) return session;
  const id = parseUserId(rawId);
  if (id === null) return problem(404, 'not-found');
  try {
    const result = await services.userAdmin.resetPassword(id, session.userId);
    // Сам пароль в лог не пишется — только факт сброса
    services.log('info', 'user password reset', { by: session.login, login: result.user.login });
    const response: ResetPasswordResponse = {
      user: toUserDto(result.user),
      temporaryPassword: result.temporaryPassword,
      revokedSessions: result.revokedSessions,
    };
    return json(200, response);
  } catch (error) {
    return fromAdminError(error);
  }
}

// ──────────────────────────── /api/admin/sessions ────────────────────────────

export function handleListSessions(request: Request, services: Services): Response {
  const session = enter(request, services, { role: 'operator' });
  if (session instanceof Response) return session;
  const items = services.sessions.listActive().map((info) => toSessionDto(info, session));
  return json(200, { items } satisfies SessionList);
}

export function handleRevokeSession(request: Request, services: Services, id: string): Response {
  const session = enter(request, services, { role: 'operator', write: true });
  if (session instanceof Response) return session;
  // Уже отозванная или истёкшая сессия — тоже 404: повторный отзыв ничего не меняет, а экран перечитает список
  if (!SESSION_ID_FORMAT.test(id) || !services.sessions.revokeById(id, 'admin')) return problem(404, 'not-found');
  services.log('info', 'session revoked', { by: session.login, session: id });
  return NO_CONTENT();
}

// ─────────────────────────────── /api/me/* ───────────────────────────────

export function handleProfile(request: Request, services: Services): Response {
  const session = enter(request, services);
  if (session instanceof Response) return session;
  const user = services.users.summary(session.userId, services.now());
  const profile: Profile = {
    login: session.login,
    role: session.role,
    lastLoginAt: typeof user?.lastLoginAt === 'number' ? iso(user.lastLoginAt) : null,
    sessions: services.sessions.listActive(session.userId).map((info) => toSessionDto(info, session)),
  };
  return json(200, profile);
}

/** Завершить одну свою сессию. Чужой идентификатор неотличим от несуществующего: 404 */
export function handleRevokeOwnSession(request: Request, services: Services, id: string): Response {
  const session = enter(request, services, { write: true });
  if (session instanceof Response) return session;
  if (!SESSION_ID_FORMAT.test(id)) return problem(404, 'not-found');
  const target = services.sessions.listActive(session.userId).find((info) => info.id === id);
  if (!target || !services.sessions.revokeById(id, 'logout', session.userId)) return problem(404, 'not-found');
  // Завершена текущая — это обычный выход: cookie стирается
  return target.tokenHash === session.tokenHash ? signedOut(request, services) : NO_CONTENT();
}

/** «Выйти на всех устройствах»: отзываются все сессии пользователя, включая текущую */
export function handleLogoutEverywhere(request: Request, services: Services): Response {
  const session = enter(request, services, { write: true });
  if (session instanceof Response) return session;
  services.sessions.revokeAllForUser(session.userId, 'logout_all');
  return signedOut(request, services);
}

export async function handleChangePassword(request: Request, services: Services): Promise<Response> {
  const session = enter(request, services, { write: true, body: true, temporaryPassword: true });
  if (session instanceof Response) return session;
  const body = await readObject(request, ['currentPassword', 'newPassword'] satisfies (keyof ChangePasswordRequest)[]);
  if (!body || typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
    return invalid('Нужны строковые поля currentPassword и newPassword');
  }
  const result = await services.userAdmin.changeOwnPassword(
    session.userId,
    body.currentPassword.slice(0, PASSWORD_MAX_LENGTH + 1),
    body.newPassword,
    clientIp(request, services.config.trustProxy),
  );
  if (result.ok) {
    services.log('info', 'password changed', { login: session.login, revokedSessions: result.revokedSessions });
    return signedOut(request, services);
  }
  if (result.reason === 'throttled') {
    const seconds = Math.ceil(result.retryAfterMs / 1000);
    return problem(429, 'too-many-attempts', { retryAfterSeconds: seconds }, { 'Retry-After': String(seconds) });
  }
  if (result.reason === 'wrong-password') return problem(422, 'invalid-current-password');
  return invalid(
    result.reason === 'same-password'
      ? 'Новый пароль совпадает с текущим'
      : `Новый пароль: от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов`,
  );
}

/**
 * Тур пройден или пропущен: гид больше не открывается сам. Тела нет — отметка задана путём, поэтому PUT
 * идемпотентен. С временным паролем маршрут закрыт: до смены пароля гид не показывается.
 */
export function handleCompleteTour(request: Request, services: Services, tour: string): Response {
  const session = enter(request, services, { write: true });
  if (session instanceof Response) return session;
  if (!isTourId(tour)) return problem(404, 'not-found');
  if (!hasRole(session.role, TOUR_ROLE[tour])) return problem(403, 'forbidden');
  services.tours.complete(session.userId, tour, services.now());
  return NO_CONTENT();
}

/** «Пройти гид заново»: отметки сняты, туры снова открываются при первом открытии экранов */
export function handleResetTours(request: Request, services: Services): Response {
  const session = enter(request, services, { write: true });
  if (session instanceof Response) return session;
  services.tours.reset(session.userId);
  return NO_CONTENT();
}
