import { expect, test } from '@playwright/test';
import { USERS, signIn } from '../support/app';

/**
 * White is the brand's main color: a computer in dark mode still gets the light app until the
 * person chooses otherwise in "Mi cuenta". The choice is applied before the first paint
 * (public/theme-init.js, served as-is by the production bundle), so it holds across a reload.
 */
test.use({ colorScheme: 'dark' });

test('sale clara aunque la computadora esté en modo oscuro, y se puede elegir oscuro', async ({
  page,
}) => {
  const html = page.locator('html');
  await page.goto('/login');
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(246, 247, 251)',
  );
  await expect(page.locator('img.brand-logo-light')).toBeVisible();

  await signIn(page, USERS.admin);
  await page.goto('/mi-cuenta');
  const appearance = page.getByRole('group', { name: 'Apariencia' });
  await expect(appearance.getByRole('radio', { name: /^Claro/ })).toBeChecked();
  await appearance.getByRole('radio', { name: /^Oscuro/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('img.brand-logo-dark').first()).toBeVisible();
  await expect(page.locator('img.brand-logo-light').first()).toBeHidden();
});
