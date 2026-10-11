// Что web узнаёт из HTTP-запроса: адрес клиента, протокол, свой ли это origin, cookie сессии.

/** С HTTPS — префикс __Host-: браузер не примет такую cookie с поддомена и без Secure (ADR 0016) */
export const SESSION_COOKIE = 'cpt_session';
export const SECURE_SESSION_COOKIE = '__Host-cpt_session';

export function isSecureRequest(request: Request, trustProxy: boolean): boolean {
  if (trustProxy) {
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    if (forwarded) return forwarded === 'https';
  }
  return new URL(request.url).protocol === 'https:';
}

/**
 * Адрес клиента для задержки входа и списка сессий. X-Forwarded-For клиент может прислать сам, поэтому без
 * доверенного прокси заголовок игнорируется. С прокси берётся последний адрес: его дописал прокси, а не клиент.
 */
export function clientIp(request: Request, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const forwarded = request.headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last ? last.slice(0, 45) : null;
}

/**
 * Защита от CSRF, слой 3 из ADR 0016: у мутирующего запроса заголовок Origin обязан совпадать с адресом самого web.
 * Запрос без Origin отклоняется: браузеры шлют его со всеми POST, PATCH и DELETE.
 */
export function isSameOrigin(request: Request, trustProxy: boolean): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const forwardedHost = trustProxy ? request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() : undefined;
  const host = forwardedHost || request.headers.get('host') || new URL(request.url).host;
  return originHost === host;
}

export function isJsonRequest(request: Request): boolean {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return type === 'application/json';
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function readSessionToken(request: Request): string | undefined {
  return readCookie(request, SECURE_SESSION_COOKIE) ?? readCookie(request, SESSION_COOKIE);
}

/** HttpOnly — скрипт страницы не прочитает токен; SameSite=Lax — cookie не уйдёт с чужого POST */
export function sessionCookie(token: string, expiresAt: number, now: number, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const name = secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  const name = secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
