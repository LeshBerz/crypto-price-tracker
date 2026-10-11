// SSE-прокси с перепроверкой сессии на каждом heartbeat (ADR 0016).
import { handleStream } from '@/server/bff/stream-http';
import { getServices } from '@/server/container';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return handleStream(request, getServices());
}
