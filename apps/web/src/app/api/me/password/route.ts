// PUT — смена своего пароля: нужен текущий, после смены все сессии отозваны (ADR 0016).
import { handleChangePassword } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

export function PUT(request: Request): Promise<Response> {
  return handleChangePassword(request, getServices());
}
