'use client';

import { ChevronDown, LogOut, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Role } from '@/server/users';

const ROLE_LABELS: Record<Role, string> = { viewer: 'Viewer', operator: 'Operator' };

export function UserMenu({ login, role }: { login: string; role: Role }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const logout = async () => {
    setPending(true);
    try {
      // Сессия отзывается на сервере: украденная cookie после выхода бесполезна
      await fetch('/api/session', { method: 'DELETE' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={`Меню пользователя ${login}`} />}>
        <User aria-hidden="true" />
        <span className="hidden max-w-32 truncate sm:inline">{login}</span>
        <Badge variant="secondary" className="max-sm:hidden">
          {ROLE_LABELS[role]}
        </Badge>
        <ChevronDown aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {/* На узком экране логин и роль в шапку не помещаются — они показаны здесь */}
        <DropdownMenuGroup className="sm:hidden">
          <DropdownMenuLabel>
            {login} · {ROLE_LABELS[role]}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem disabled={pending} onClick={logout}>
          <LogOut aria-hidden="true" />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
