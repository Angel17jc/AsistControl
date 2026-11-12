import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  followSystemTheme,
  readThemePreference,
  saveThemePreference,
} from './theme';

const theme = () => document.documentElement.getAttribute('data-theme');

/** A computer in dark or light mode, with a way to switch it while the page is open. */
function computerIn(mode: 'dark' | 'light') {
  let dark = mode === 'dark';
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('dark') && dark;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return {
    switchTo(next: 'dark' | 'light') {
      dark = next === 'dark';
      listeners.forEach((fn) => fn());
    },
  };
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('is light by default, even on a computer in dark mode', () => {
    computerIn('dark');
    expect(readThemePreference()).toBe('light');
    applyTheme(readThemePreference());
    expect(theme()).toBe('light');
  });

  it('remembers the dark choice', () => {
    saveThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readThemePreference()).toBe('dark');
    expect(theme()).toBe('dark');
  });

  it('follows the computer when asked to, also when it switches while open', () => {
    const computer = computerIn('light');
    saveThemePreference('system');
    expect(theme()).toBe('light');
    const stop = followSystemTheme();
    computer.switchTo('dark');
    expect(theme()).toBe('dark');
    stop();
  });

  it('ignores the computer once a fixed choice is made', () => {
    const computer = computerIn('light');
    saveThemePreference('light');
    const stop = followSystemTheme();
    computer.switchTo('dark');
    expect(theme()).toBe('light');
    stop();
  });

  it('falls back to light on an unknown value or blocked storage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readThemePreference()).toBe('light');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readThemePreference()).toBe('light');
  });
});
