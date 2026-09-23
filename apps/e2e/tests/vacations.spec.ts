import { type Locator, type Page, expect, test } from '@playwright/test';
import { ApiClient, USERS, card, signIn } from '../support/app';

/**
 * Vacation balances from both sides: the employee sees what is left before asking, and the
 * API refuses what the balance cannot cover; HR adjusts balances and manages the rules.
 * The test database persists between local runs, so everything is measured as a difference.
 */
test.describe('Vacaciones', () => {
  test('el empleado ve su saldo y no puede pedir más de lo que tiene', async ({
    page,
    request,
  }) => {
    const api = await ApiClient.signIn(request, USERS.employee.email);
    await api.cancelPendingVacations();

    await signIn(page, USERS.employee);
    await page.getByRole('link', { name: 'Solicitudes' }).click();
    const mine = card(page, 'Mis vacaciones');
    await expect(mine).toContainText('Tiempo completo');
    const pendingBefore = await figure(mine, 'Pendientes');

    // Sixty days is more than anyone here has earned.
    await requestVacation(page, daysFromToday(40), daysFromToday(100));
    await expect(page.getByRole('alert')).toContainText('Insufficient vacation balance');

    // Three weekdays well ahead do fit, and are held in reserve at once.
    const monday = nextMonday(45);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await requestVacation(page, monday, addDays(monday, 3));
    await expect.poll(() => figure(mine, 'Pendientes')).toBeGreaterThan(pendingBefore);

    await api.cancelPendingVacations();
  });

  test('RRHH ajusta un saldo y gestiona los tipos de contrato', async ({ page }) => {
    await signIn(page, USERS.hr);

    await page.getByRole('link', { name: 'Empleados' }).click();
    await page.getByLabel('Buscar empleado').fill('Conforme');
    await page.getByRole('button', { name: 'Vacaciones de Angel Conforme' }).click();
    const panel = card(page, 'Vacaciones de Angel Conforme');
    await expect(panel).toContainText('Tiempo completo');
    const before = await available(panel);

    const adjust = panel.getByRole('form', { name: 'Ajustar saldo' });
    await adjust.getByLabel('Días').fill('2');
    await adjust.getByLabel('Motivo del ajuste').fill('Ajuste de prueba automatizada');
    await adjust.getByRole('button', { name: 'Ajustar' }).click();
    await expect.poll(() => available(panel)).toBe(before + 2);
    await expect(panel).toContainText('Ajuste de prueba automatizada');

    // Contract types: create one, then remove it (nobody uses it yet).
    await page.getByRole('link', { name: 'Contratos' }).click();
    const name = `Pasantía QA ${Date.now().toString().slice(-6)}`;
    await page.getByRole('button', { name: 'Nuevo tipo de contrato' }).click();
    const form = page.getByRole('form', { name: 'Nuevo tipo de contrato' });
    await form.getByLabel('Nombre').fill(name);
    await form.getByLabel('Días de vacaciones por año').fill('10');
    await form.getByRole('button', { name: 'Crear' }).click();

    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('10 días');
    await row.getByRole('button', { name: `Eliminar ${name}` }).click();
    await expect(row).toHaveCount(0);
  });
});

async function requestVacation(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: 'Solicitar permiso' }).click();
  await page.getByLabel('Tipo').selectOption('VACATION');
  await page.getByLabel('Desde').fill(`${from}T00:00`);
  await page.getByLabel('Hasta').fill(`${to}T00:00`);
  await page.getByLabel('Motivo').fill('Vacaciones');
  await page.getByRole('button', { name: 'Enviar' }).click();
}

/** A figure of the balance card, e.g. "Pendientes" → 3. */
async function figure(scope: Locator, label: string): Promise<number> {
  const text = await scope
    .locator('dt', { hasText: label })
    .locator('xpath=following-sibling::dd[1]')
    .textContent();
  return parseDays(text ?? '');
}

async function available(scope: Locator): Promise<number> {
  const text = await scope
    .getByText(/^-?[\d,]+ días?$/)
    .first()
    .textContent();
  return parseDays(text ?? '');
}

function parseDays(text: string): number {
  return Number(text.replace(/[^\d,-]/g, '').replace(',', '.'));
}

function daysFromToday(days: number): string {
  return addDays(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date()),
    days,
  );
}

function nextMonday(atLeastDaysAhead: number): string {
  let date = daysFromToday(atLeastDaysAhead);
  while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 1) date = addDays(date, 1);
  return date;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
