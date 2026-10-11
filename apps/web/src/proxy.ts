// Proxy (в Next 15 и раньше — middleware). Только быстрый редирект по наличию cookie, без похода в БД:
// настоящая проверка сессии — в серверном layout и Route Handlers (ADR 0016).
import { NextResponse, type NextRequest } from 'next/server';
import { SECURE_SESSION_COOKIE, SESSION_COOKIE } from '@/server/request';

export function proxy(request: NextRequest): NextResponse {
  const hasCookie = request.cookies.has(SECURE_SESSION_COOKIE) || request.cookies.has(SESSION_COOKIE);
  if (hasCookie) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Всё, кроме входа, маршрутов BFF (они сами отвечают 401) и статики
  matcher: ['/((?!login|api/|_next/|icon.svg|favicon.ico).*)'],
};
