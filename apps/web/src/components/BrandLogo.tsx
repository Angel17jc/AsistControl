import clsx from 'clsx';
import logoDark from '../assets/kairosig-logo-dark.png';
import logo from '../assets/kairosig-logo.png';

/**
 * The Kairosig logo. Two images, one per theme: the light one carries the brand's indigo and
 * blue, the dark one turns them light so the letters stay readable. index.css shows the one
 * that matches the theme; the hidden one is out of the accessibility tree.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <img
        src={logo}
        alt="Kairosig"
        width={451}
        height={160}
        className={clsx('brand-logo-light w-auto', className)}
      />
      <img
        src={logoDark}
        alt="Kairosig"
        width={451}
        height={160}
        className={clsx('brand-logo-dark w-auto', className)}
      />
    </>
  );
}
