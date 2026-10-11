// POST — вход, DELETE — выход, GET — кто вошёл (ADR 0016, таблица маршрутов BFF).
import { getServices } from '@/server/container';
import { handleLogin, handleLogout, handleWhoAmI } from '@/server/session-http';

export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return handleLogin(request, getServices());
}

export function DELETE(request: Request): Response {
  return handleLogout(request, getServices());
}

export function GET(request: Request): Response {
  return handleWhoAmI(request, getServices());
}
