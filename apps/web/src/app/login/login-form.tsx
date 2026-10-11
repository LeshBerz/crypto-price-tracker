'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Notice = { kind: 'info' | 'error'; text: string };

function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} с`;
  return `${Math.ceil(seconds / 60)} мин`;
}

/** Ответ сервера → текст для человека. Причину отказа (нет логина или неверный пароль) сервер не раскрывает */
async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401) return 'Неверный логин или пароль.';
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After')) || 60;
    return `Слишком много попыток входа. Повторите через ${waitText(seconds)}.`;
  }
  return 'Не удалось войти. Повторите попытку позже.';
}

export function LoginForm({ expired }: { expired: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(
    expired ? { kind: 'info', text: 'Сессия завершена. Войдите снова.' } : null,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const login = String(form.get('username') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (login === '' || password === '') {
      setNotice({ kind: 'error', text: 'Введите логин и пароль.' });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      if (!response.ok) {
        setNotice({ kind: 'error', text: await describeFailure(response) });
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setNotice({ kind: 'error', text: 'Нет связи с сервером. Проверьте соединение и повторите.' });
    } finally {
      setPending(false);
    }
  };

  return (
    // method="post": если форму отправят до загрузки скрипта, браузер не положит пароль в адресную строку
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      {notice?.kind === 'info' && (
        <p role="status" className="rounded-lg border border-info-border bg-info-bg px-3 py-2 text-sm text-info">
          {notice.text}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login">Логин</Label>
        <Input
          id="login"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="h-10"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Пароль</Label>
        <div className="flex gap-2">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            aria-describedby="login-error"
            className="h-10"
          />
          <Button
            type="button"
            variant="outline"
            className="h-10"
            aria-pressed={showPassword}
            aria-controls="password"
            onClick={() => setShowPassword((shown) => !shown)}
          >
            {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            {showPassword ? 'Скрыть' : 'Показать'}
          </Button>
        </div>
      </div>
      {/* role="alert" всегда в разметке: скринридер объявляет текст, когда он появляется */}
      <p id="login-error" role="alert" className="min-h-5 text-sm text-destructive">
        {notice?.kind === 'error' ? notice.text : ''}
      </p>
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? 'Вход…' : 'Войти'}
      </Button>
    </form>
  );
}
