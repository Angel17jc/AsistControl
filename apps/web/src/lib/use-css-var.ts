import { useEffect, useState } from 'react';

/**
 * SVG presentation attributes (Recharts `fill`, `stroke`) cannot resolve CSS variables,
 * so chart colors are read from the tokens and re-read when the color scheme changes.
 */
export function useCssVar(name: string, fallback: string): string {
  const read = () =>
    typeof window === 'undefined'
      ? fallback
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const [value, setValue] = useState(read);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => setValue(read());
    media?.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      media?.removeEventListener('change', update);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return value;
}
