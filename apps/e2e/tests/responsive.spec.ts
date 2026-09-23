import { expect, test } from '@playwright/test';
import { USERS, signIn } from '../support/app';

/**
 * Runs on the `mobile` project (Pixel 7). Guards are on the layout: supervisors review
 * attendance from a phone, and a sidebar meant for a laptop can easily push the page
 * sideways or hide the way out of the session.
 */
test('el panel es usable en un teléfono', async ({ page }) => {
  await signIn(page, USERS.admin);

  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' }).first()).toBeVisible();

  // Tables scroll inside their card; the page itself must not scroll sideways.
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(1);

  // Device cards carry long unbroken strings (Hikvision serials are ~36 characters).
  await nav.getByRole('link', { name: 'Dispositivos' }).click();
  await expect(page.getByRole('heading', { name: 'Dispositivos', level: 1 })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);

  // The notifications panel opens from the top-right corner and must stay on screen.
  await page.getByRole('button', { name: /^Notificaciones/ }).click();
  const panel = await page.getByRole('dialog', { name: 'Notificaciones' }).boundingBox();
  const width = page.viewportSize()!.width;
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');

  await nav.getByRole('link', { name: 'Asistencia' }).click();
  await expect(page.getByRole('heading', { name: 'Asistencia', level: 1 })).toBeVisible();
});
