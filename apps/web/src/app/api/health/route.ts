// Готовность самого web для healthcheck контейнера: конфиг прочитан, БД сессий открыта и отвечает.
// Доступность api сюда не входит: без api web остаётся рабочим — вход работает, экран показывает деградацию.
import { getServices } from '@/server/container';
import { json } from '@/server/problem';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  getServices().db.prepare('SELECT 1').get();
  return json(200, { status: 'ok' });
}
