// DELETE — «пройти гид заново»: отметки туров сняты (ADR 0018). Любая роль.
import { handleResetTours } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

export function DELETE(request: Request): Response {
  return handleResetTours(request, getServices());
}
