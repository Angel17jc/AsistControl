import { expect, test } from '@playwright/test';
import { ApiClient, USERS, signIn } from '../support/app';

/**
 * The month is what Human Resources downloads. A download is built in the browser from an authenticated
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
    page.getByRole('button', { name: 'CSV', exact: true }).click(),
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

test('Recursos Humanos descarga la asistencia del mes en Excel y en PDF', async ({
  page,
  request,
}) => {
  const api = await ApiClient.signIn(request, USERS.admin.email);
  await api.manualPunch();

  await signIn(page, USERS.admin);
  await page.getByRole('link', { name: 'Reportes' }).click();
  // The page opens on this report, on the current month.
  await expect(page.getByLabel('Reporte')).toHaveValue('attendance');
  await expect(page.getByText(/[1-9]\d* filas/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'salida almuerzo' })).toBeVisible();

  const save = async (button: string) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: button }).click(),
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
    return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
  };

  const excel = await save('Descargar Excel');
  expect(excel.name).toMatch(/^asistencia-\d{4}-\d{2}\.xlsx$/);
  // An .xlsx is a zip file.
  expect(excel.bytes.subarray(0, 2).toString()).toBe('PK');

  const pdf = await save('Descargar PDF');
  expect(pdf.name).toMatch(/^asistencia-\d{4}-\d{2}\.pdf$/);
  expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');

  // Another month is one choice away, and the PDF is only for this report.
  await page.getByLabel('Mes').selectOption({ index: 1 });
  await page.getByLabel('Reporte').selectOption('daily');
  await expect(page.getByLabel('Desde')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar PDF' })).toHaveCount(0);
});
