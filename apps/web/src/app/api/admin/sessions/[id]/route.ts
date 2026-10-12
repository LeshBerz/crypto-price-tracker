// DELETE — отзыв сессии оператором; открытый поток событий этой сессии закроется на ближайшем heartbeat.
import { handleRevokeSession } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  return handleRevokeSession(request, getServices(), (await params).id);
}
