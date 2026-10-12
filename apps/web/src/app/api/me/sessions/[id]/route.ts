// DELETE — завершить одну свою сессию (ui-flows §3.4).
import { handleRevokeOwnSession } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return handleRevokeOwnSession(request, getServices(), (await params).id);
}
