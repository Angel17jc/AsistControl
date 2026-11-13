import type { ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';

/**
 * The frame of the pages seen before signing in: the logo, a title, and a card with the
 * helmet's yellow on top. `below` goes under the card (links, help).
 */
export function AuthFrame({
  heading,
  intro,
  children,
  below,
}: {
  heading: string;
  intro?: ReactNode;
  children: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-surface-1 px-4 py-12 sm:bg-surface-0">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLogo className="mb-5 h-20" />
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-1">
            {heading}
          </h1>
          {intro && <p className="mt-1 text-sm text-ink-2">{intro}</p>}
        </div>
        <div className="rounded-xl border border-t-4 border-line border-t-brand-yellow bg-surface-1 p-6 shadow-sm">
          {children}
        </div>
        {below && <div className="mt-4 grid gap-2 text-center text-xs text-ink-3">{below}</div>}
      </div>
    </div>
  );
}
