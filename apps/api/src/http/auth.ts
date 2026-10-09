// Аутентификация по Bearer API key и проверка scope (ADR 0002). Здесь — порт и общая логика 401/403
// по RFC 6750; сама проверка ключа (SHA-256 + timingSafeEqual по БД) — адаптер auth/api-key-authenticator.ts.
// Аналог в Nest: AuthGuard + RolesGuard с метаданными @Scopes() — здесь scopes берутся из x-required-scopes.
import type { RequestHandler } from 'express';
import { HttpProblem } from './problem.ts';

export type Principal = {
  /** id ключа в api_keys — для логов и аудита; сам ключ дальше middleware не уходит */
  keyId: number;
  scopes: ReadonlySet<string>;
};

export interface Authenticator {
  /** Токен из заголовка Authorization: Bearer <token>. null — ключ неизвестен или отозван */
  authenticate(token: string): Promise<Principal | null>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      principal: Principal | null;
    }
  }
}

// RFC 6750 §2.1: схема регистронезависима, токен — b64token
const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

export function requireScopes(authenticator: Authenticator, scopes: readonly string[]): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('authorization');
    if (header === undefined) {
      // Нет учётных данных — только схема, без error (RFC 6750 §3.1)
      throw new HttpProblem(401, 'unauthorized', {
        detail: 'Missing Authorization: Bearer <API key>',
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }
    const token = BEARER.exec(header)?.[1];
    const principal = token === undefined ? null : await authenticator.authenticate(token);
    if (principal === null) {
      throw new HttpProblem(401, 'unauthorized', {
        detail: 'API key is invalid or revoked',
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      });
    }
    const missing = scopes.filter((scope) => !principal.scopes.has(scope));
    if (missing.length > 0) {
      throw new HttpProblem(403, 'forbidden', {
        detail: `API key lacks required scope: ${missing.join(' ')}`,
        headers: { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scopes.join(' ')}"` },
      });
    }
    res.locals.principal = principal;
    res.locals.log = res.locals.log.child({ keyId: principal.keyId });
    next();
  };
}
