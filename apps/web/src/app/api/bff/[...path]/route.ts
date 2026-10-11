// Прокси в apps/api по allowlist (ADR 0016). Методы — только те, что есть в контракте api.
import { handleBff } from '@/server/bff/bff-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

function handler(request: Request): Promise<Response> {
  return handleBff(request, getServices());
}

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
