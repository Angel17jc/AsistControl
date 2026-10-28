import { expect, test } from '@playwright/test';
import { ApiClient, USERS, signIn } from '../support/app';

/**
 * The presence board follows punches as they happen. The employee is new and has no schedule,
 * so their day is the calendar day and the result does not depend on the hour the test runs.
 */
test('la presencia cambia en vivo cuando alguien marca', async ({ page, request }) => {
  const api = await ApiClient.signIn(request, USERS.admin.email);
  const employee = await api.createEmployee('Presencia');
  const suffix = employee.name.split(' ').at(-1)!;

  await signIn(page, USERS.admin);
  await expect(page.getByText('Tiempo real activo')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Presencia' })
    .click();
  await page.getByLabel('Buscar').fill(suffix);
  const row = page.getByRole('row').filter({ hasText: suffix });
  await expect(row).toContainText('Sin horario');

  await api.manualPunch(employee.id);
  // The WebSocket refreshes it at once; on its own the board only polls once a minute.
  await expect(row).toContainText('En la empresa', { timeout: 30_000 });
  await expect(row).toContainText('Entrada');
});
