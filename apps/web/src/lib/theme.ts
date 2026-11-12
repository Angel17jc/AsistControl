import { useState } from 'react';

/**
 * Appearance. White is the brand's main color, so the app is light unless the person chooses
 * otherwise in "Mi cuenta", whatever the computer's own mode. The choice lives in this
 * browser only. public/theme-init.js applies it before the first paint with the same rules.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'asistcontrol.theme';
const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return PREFERENCES.find((p) => p === saved) ?? 'light';
  } catch {
    return 'light';
  }
}

function systemIsDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

/** Sets `data-theme` on the root element: the stylesheet only goes dark with `dark`. */
export function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && systemIsDark());
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
  }
  applyTheme(preference);
}

/** With "Como la computadora", follows the computer when it switches mode while open. */
export function followSystemTheme(): () => void {
  const media = window.matchMedia?.(DARK_QUERY);
  if (!media) return () => {};
  const update = () => {
    if (readThemePreference() === 'system') applyTheme('system');
  };
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState(readThemePreference);
  const choose = (next: ThemePreference) => {
    saveThemePreference(next);
    setPreference(next);
  };
  return [preference, choose];
}
