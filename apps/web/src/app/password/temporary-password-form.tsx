'use client';

import { useState } from 'react';
import { PasswordForm, toLogin } from '@/components/account/password-form';
import { QueryProvider } from '@/components/query-provider';
import { Button } from '@/components/ui/button';

/**
 * Та же форма, что в профиле: «текущий» пароль здесь — временный. Рядом — выход: человек, который вошёл
 * не под своей учётной записью, не должен быть заперт на этом экране.
 */
export function TemporaryPasswordForm({ login }: { login: string }) {
  const [leaving, setLeaving] = useState(false);

  const logout = async () => {
    setLeaving(true);
    try {
      await fetch('/api/session', { method: 'DELETE' });
    } finally {
      toLogin();
    }
  };

  return (
    <QueryProvider>
      <div className="flex flex-col gap-3">
        <PasswordForm login={login} currentLabel="Временный пароль" />
        <Button type="button" variant="ghost" size="sm" className="self-start" disabled={leaving} onClick={logout}>
          {leaving ? 'Выход…' : 'Выйти без смены пароля'}
        </Button>
      </div>
    </QueryProvider>
  );
}
