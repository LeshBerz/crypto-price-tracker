// PATCH — роль и статус пользователя (ADR 0016). Только оператор.
import { handleUpdateUser } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  return handleUpdateUser(request, getServices(), (await params).id);
}
