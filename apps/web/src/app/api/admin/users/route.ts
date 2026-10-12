// GET — список пользователей, POST — создание (ADR 0016). Только оператор; данные в web.db.
import { handleCreateUser, handleListUsers } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  return handleListUsers(request, getServices());
}

export function POST(request: Request): Promise<Response> {
  return handleCreateUser(request, getServices());
}
