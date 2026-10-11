// Сессия текущего запроса для серверных компонентов и layout. Проверка идёт в БД, а не по наличию cookie (ADR 0016).
import { cookies } from 'next/headers';
import { cache } from 'react';
import { getServices } from './container';
import { SECURE_SESSION_COOKIE, SESSION_COOKIE } from './request';
import type { Session } from './sessions';

export type CurrentSession = { session: Session | null; hadCookie: boolean };

/** cache(): layout и страница одного запроса делят одну выборку из БД */
export const getCurrentSession = cache(async (): Promise<CurrentSession> => {
  const store = await cookies();
  const token = store.get(SECURE_SESSION_COOKIE)?.value ?? store.get(SESSION_COOKIE)?.value;
  return { session: getServices().sessions.validate(token), hadCookie: token !== undefined };
});
