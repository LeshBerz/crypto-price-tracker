'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { isThemePreference, nextTheme, THEME_STORAGE_KEY, type ThemePreference } from '@/lib/theme';

const LABELS: Record<ThemePreference, string> = { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };
const ICONS = { system: Monitor, light: Sun, dark: Moon };

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    // localStorage недоступен (приватный режим, запрет хранилища) — остаётся системная тема
    return 'system';
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Событие storage приходит из других вкладок: тема меняется во всех сразу
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function apply(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function store(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // выбор действует до перезагрузки страницы
  }
  apply(preference);
  listeners.forEach((listener) => listener());
}

export function ThemeToggle() {
  // Сервер не видит localStorage: на сервере и при гидратации — «системная», затем React подставит сохранённый выбор
  const preference = useSyncExternalStore<ThemePreference>(subscribe, readPreference, () => 'system');

  useEffect(() => {
    apply(preference);
    if (preference !== 'system') return;
    // При выборе «Как в системе» страница следует за сменой темы ОС без перезагрузки
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const Icon = ICONS[preference];
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => store(nextTheme(preference))}
      aria-label={`Тема: ${LABELS[preference]}. Переключить`}
      title={`Тема: ${LABELS[preference]}`}
    >
      <Icon aria-hidden="true" />
      <span className="hidden sm:inline">{LABELS[preference]}</span>
    </Button>
  );
}
