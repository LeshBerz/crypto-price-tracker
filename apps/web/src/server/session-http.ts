// HTTP-обработчики /api/session на стандартных Request и Response: тестируются без запуска Next.
import type { Services } from './container';
import {
  clearSessionCookie,
  clientIp,
  isJsonRequest,
  isSameOrigin,
  isSecureRequest,
  readSessionToken,
  sessionCookie,
} from './request';

type ProblemSlug =
  | 'validation-error'
  | 'unsupported-media-type'
  | 'forbidden-origin'
  | 'invalid-credentials'
  | 'too-many-attempts'
  | 'unauthorized';

const TITLES: Record<ProblemSlug, string> = {
  'validation-error': 'Некорректный запрос',
  'unsupported-media-type': 'Ожидается application/json',
  'forbidden-origin': 'Запрос с другого сайта отклонён',
  'invalid-credentials': 'Неверный логин или пароль',
  'too-many-attempts': 'Слишком много попыток входа',
  unauthorized: 'Требуется вход',
};

/** Тот же формат ошибок, что у api (RFC 9457): клиентский код разбирает ответы BFF и api одинаково */
function problem(status: number, slug: ProblemSlug, extra: Record<string, unknown> = {}, headers: HeadersInit = {}) {
  return new Response(JSON.stringify({ type: `urn:cpt:web:problem:${slug}`, title: TITLES[slug], status, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/problem+json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Слои 2 и 3 защиты от CSRF: JSON-тело (HTML-форма его не отправит) и свой Origin */
function rejectForeign(request: Request, services: Services, requireJson: boolean): Response | null {
  if (requireJson && !isJsonRequest(request)) return problem(415, 'unsupported-media-type');
  if (!isSameOrigin(request, services.config.trustProxy)) return problem(403, 'forbidden-origin');
  return null;
}

async function readCredentials(request: Request): Promise<{ login: string; password: string } | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { login, password } = body as Record<string, unknown>;
  if (typeof login !== 'string' || typeof password !== 'string' || login === '' || password === '') return null;
  // Грубый предел размера: точные правила формата проверяет AuthService, не раскрывая их в ответе
  if (login.length > 256 || password.length > 1024) return null;
  return { login, password };
}

export async function handleLogin(request: Request, services: Services): Promise<Response> {
  const rejected = rejectForeign(request, services, true);
  if (rejected) return rejected;
  const credentials = await readCredentials(request);
  if (!credentials) return problem(400, 'validation-error', { detail: 'Нужны строковые поля login и password' });

  const { trustProxy } = services.config;
  const result = await services.auth.login(credentials.login, credentials.password, {
    ip: clientIp(request, trustProxy),
    userAgent: request.headers.get('user-agent'),
  });
  if (!result.ok) {
    if (result.reason === 'throttled') {
      const seconds = Math.ceil(result.retryAfterMs / 1000);
      return problem(429, 'too-many-attempts', { retryAfterSeconds: seconds }, { 'Retry-After': String(seconds) });
    }
    // Один ответ на все причины отказа: нет логина, неверный пароль, пользователь отключён
    return problem(401, 'invalid-credentials');
  }
  const secure = isSecureRequest(request, trustProxy);
  return json(
    200,
    { login: result.login, role: result.role },
    { 'Set-Cookie': sessionCookie(result.token, result.expiresAt, services.now(), secure) },
  );
}

export function handleLogout(request: Request, services: Services): Response {
  const rejected = rejectForeign(request, services, false);
  if (rejected) return rejected;
  services.sessions.revoke(readSessionToken(request), 'logout');
  // Cookie стирается всегда: выход с уже истёкшей сессией — тоже успешный выход
  const secure = isSecureRequest(request, services.config.trustProxy);
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie(secure), 'Cache-Control': 'no-store' },
  });
}

export function handleWhoAmI(request: Request, services: Services): Response {
  const session = services.sessions.validate(readSessionToken(request));
  if (!session) return problem(401, 'unauthorized');
  return json(200, { login: session.login, role: session.role });
}
