import { expect, test } from '@playwright/test';
import { ApiClient, USERS, card, signIn } from '../support/app';

/**
 * Punches taken while someone is watching must reach the dashboard on their own, over the
 * WebSocket, with no reload and no polling. The terminal is driven through the API here:
 * what is under test is the browser end of the pipeline.
 */
test('el dashboard recibe marcaciones en vivo sin recargar', async ({ page, request }) => {
  const api = await ApiClient.signIn(request, USERS.admin.email);
  await signIn(page, USERS.admin);
  await expect(page.getByText('Tiempo real activo')).toBeVisible();

  const device = await api.createMockDevice('Terminal en vivo');

  const rows = card(page, 'Últimas marcaciones').getByRole('row');
  // The terminal was registered after this page loaded and nothing has punched on it yet.
  await expect(rows.filter({ hasText: device.name })).toHaveCount(0);

  await api.autoPunches(device.id, 1_000);
  try {
    // Nothing else can explain the row: the summary is only refetched once a minute.
    await expect(rows.filter({ hasText: device.name }).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await api.autoPunches(device.id, 0);
  }
});
