// GET — профиль и свои сессии, DELETE — «выйти на всех устройствах» (ADR 0016). Любая роль.
import { handleLogoutEverywhere, handleProfile } from '@/server/account-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  return handleProfile(request, getServices());
}

export function DELETE(request: Request): Response {
  return handleLogoutEverywhere(request, getServices());
}
