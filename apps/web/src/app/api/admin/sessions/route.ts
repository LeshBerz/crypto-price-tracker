// GET — действующие сессии всех пользователей (ADR 0016). Только оператор.
import { handleListSessions } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  return handleListSessions(request, getServices());
}
