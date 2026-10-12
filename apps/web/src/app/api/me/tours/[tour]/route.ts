// PUT — тур гида пройден или пропущен (ADR 0018).
import { handleCompleteTour } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ tour: string }> };

export async function PUT(request: Request, { params }: Context): Promise<Response> {
  return handleCompleteTour(request, getServices(), (await params).tour);
}
