// POST — сброс пароля: новый временный пароль в ответе, все сессии пользователя отозваны (ADR 0016).
import { handleResetPassword } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleResetPassword(request, getServices(), (await params).id);
}
