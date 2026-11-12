import { expect, test } from '@playwright/test';
import { PASSWORD, USERS, signIn } from '../support/app';

/**
 * The session lives in two places: an access token in memory and a rotating refresh token in
 * an httpOnly cookie. Only a browser can prove that the combination survives a reload and is
 * really gone after signing out.
 */
test.describe('Sesión', () => {
  test('rechaza credenciales inválidas sin abrir sesión', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(USERS.admin.email);
    await page.getByLabel('Contraseña').fill('contrasena-incorrecta');
    await page.getByRole('button', { name: 'Ingresar' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);
  });

  test('señala lo que falta, deja ver la contraseña y entra con lo corregido', async ({ page }) => {
    await page.goto('/login');
    const email = page.getByLabel('Correo electrónico');
    const password = page.getByLabel('Contraseña');
    await expect(email).toBeFocused();

    await email.fill('admin@asistcontrol');
    await password.fill(PASSWORD);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByText('Revise el correo: debe tener la forma nombre@empresa.com.'),
    ).toBeVisible();

    const eye = page.getByRole('button', { name: 'Mostrar contraseña' });
    await eye.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue(PASSWORD);
    await eye.click();
    await expect(password).toHaveAttribute('type', 'password');

    await email.fill(USERS.admin.email);
    await expect(email).not.toHaveAttribute('aria-invalid');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });

  test('un enlace profundo sin sesión termina en el login', async ({ page }) => {
    await page.goto('/reportes');
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();

    await page.getByLabel('Correo electrónico').fill(USERS.admin.email);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Ingresar' }).click();

    // Signing in always opens the home page for the role; there is no "return to" yet.
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/:\d+\/$/);
  });

  test('la sesión sobrevive a una recarga y el cierre de sesión la elimina', async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.getByRole('link', { name: 'Reportes' }).click();
    await expect(page.getByRole('heading', { name: 'Reportes', level: 1 })).toBeVisible();

    // The access token only lives in memory: after a reload it is rebuilt from the cookie.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Reportes', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/reportes$/);

    await page.getByRole('button', { name: 'Cerrar sesión' }).filter({ visible: true }).click();
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();

    // The refresh cookie is revoked server-side, so a protected route stays closed.
    await page.goto('/reportes');
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
  });
});
