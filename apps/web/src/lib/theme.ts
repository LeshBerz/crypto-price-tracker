// Тема: системная по умолчанию, выбор пользователя хранится в localStorage (решение Q1).
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cpt-theme';
export const THEME_ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function nextTheme(current: ThemePreference): ThemePreference {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length] as ThemePreference;
}

/**
 * Выполняется в <head> до первой отрисовки, поэтому страница не мигает светлой темой у пользователя тёмной.
 * Строка, а не функция: скрипт вставляется в HTML как есть и не зависит от сборки.
 */
export const THEME_INIT_SCRIPT = `(function(){var p='system';try{p=localStorage.getItem('${THEME_STORAGE_KEY}')||'system'}catch(e){}var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'})()`;
