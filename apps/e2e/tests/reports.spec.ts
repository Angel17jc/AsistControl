import { expect, test } from '@playwright/test';
import { ApiClient, USERS, signIn } from '../support/app';

/**
 * Payroll gets its data as CSV. The download is built in the browser from an authenticated
 * fetch (no plain link can carry the token), so it has to be exercised in a real browser.
 */
test('descarga el reporte de marcaciones en CSV', async ({ page, request }) => {
  // Arrange: at least one punch inside the range the page opens with (this month).
  const api = await ApiClient.signIn(request, USERS.admin.email);
  await api.manualPunch();

  await signIn(page, USERS.admin);
  await page.getByRole('link', { name: 'Reportes' }).click();
  await page.getByLabel('Reporte').selectOption('events');
  await expect(page.getByText(/[1-9]\d* filas/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar CSV' }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString('utf8');

  const lines = csv.trim().split('\n');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines[0]).toContain('fecha_hora');
});
