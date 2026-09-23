import { expect, test } from '@playwright/test';
import { USERS, signIn } from '../support/app';

/**
 * Permissions are enforced by the API; the interface must agree with it, or people are sent
 * to pages that can only answer 403. Both halves are checked here: what the menu offers and
 * what happens when a URL is typed by hand.
 */
test.describe('Permisos en la interfaz', () => {
  test('un empleado solo ve lo suyo', async ({ page }) => {
    await signIn(page, USERS.employee);

    // No dashboard for an employee: the home page sends them to their own attendance.
    await expect(page).toHaveURL(/\/asistencia$/);
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('link', { name: 'Asistencia' })).toBeVisible();
    for (const hidden of ['Dashboard', 'Empleados', 'Dispositivos', 'Auditoría', 'Reportes']) {
      await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
    }

    // Typing the URL does not open the page either.
    await page.goto('/dispositivos');
    await expect(page).toHaveURL(/\/asistencia$/);
    await page.goto('/auditoria');
    await expect(page).toHaveURL(/\/asistencia$/);
  });

  test('un administrador llega al dashboard con todo el menú', async ({ page }) => {
    await signIn(page, USERS.admin);
    const nav = page.getByRole('navigation', { name: 'Principal' });
    for (const label of [
      'Dashboard',
      'Asistencia',
      'Empleados',
      'Dispositivos',
      'Solicitudes',
      'Reportes',
      'Auditoría',
    ]) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });

  test('un supervisor ve a su equipo pero no dispositivos ni auditoría', async ({ page }) => {
    await signIn(page, USERS.supervisor);
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('link', { name: 'Asistencia' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Empleados' })).toBeVisible();
    for (const hidden of ['Dispositivos', 'Auditoría', 'Reportes']) {
      await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
    }

    // A supervisor does have a dashboard, so a forbidden route lands there.
    await page.goto('/auditoria');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });
});
