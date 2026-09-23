import { type Locator, type Page, expect, test } from '@playwright/test';
import { USERS, card, signIn } from '../support/app';

/**
 * The reason the product exists: a terminal is registered, it stores punches, an operator
 * downloads them and the platform turns them into work days. Only a real browser run proves
 * the whole chain holds (form → API → adapter → ingestion pipeline → jornadas).
 *
 * The steps depend on each other, so they share one page and run in order.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Dispositivos y sincronización', () => {
  const name = `Terminal QA ${Date.now().toString().slice(-6)}`;
  const byte = () => Math.floor(Math.random() * 254) + 1;
  const host = `10.${byte()}.${byte()}.${byte()}`;
  let page: Page;
  /** Every control is scoped to this terminal's card: other devices offer the same ones. */
  let terminal: Locator;
  /** The day the generated punches belong to, decided by the first test that runs. */
  let workedDay = '';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    terminal = card(page, name);
    await signIn(page, USERS.admin);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('registra un marcador simulado desde el formulario', async () => {
    await page.getByRole('link', { name: 'Dispositivos' }).click();
    await page.getByRole('button', { name: 'Registrar dispositivo' }).click();

    await page.getByLabel('Nombre').fill(name);
    await page.getByLabel('IP / host').fill(host);
    await page.getByLabel('Ubicación').fill('Pruebas automatizadas');
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();

    await expect(terminal).toContainText(`${host}:4370`);
    await expect(terminal).toContainText('MOCK');
  });

  test('prueba la conexión con el marcador', async () => {
    await terminal.getByRole('button', { name: 'Probar conexión' }).click();
    await expect(terminal.getByText(/Conectado en \d+ ms/)).toBeVisible();
    await expect(terminal.getByText('En línea')).toBeVisible();
  });

  test('genera una jornada en el equipo y la descarga', async () => {
    await terminal.getByLabel('Escenario').selectOption('ON_TIME');
    workedDay = await generateLastWorkedDay();

    // Nothing has reached the platform yet: the punches are still in the terminal's memory.
    await expect(terminal.getByText(/[1-9]\d* registros en memoria/)).toBeVisible();

    await terminal.getByRole('button', { name: 'Sincronizar' }).click();
    const summary = terminal.getByText(/nuevas · \d+ duplicadas/);
    await expect(summary).toBeVisible();
    const processed = Number(/(\d+) nuevas/.exec((await summary.textContent()) ?? '')?.[1]);
    expect(processed).toBeGreaterThan(0);

    // The run is written down with its counters.
    const row = card(page, 'Historial de sincronización')
      .getByRole('row')
      .filter({ hasText: name })
      .first();
    await expect(row).toContainText('Exitosa');
    await expect(row).toContainText('Manual');
    await expect(row).toContainText(String(processed));
  });

  test('una segunda sincronización no duplica marcaciones', async () => {
    await terminal.getByRole('button', { name: 'Sincronizar' }).click();
    await expect(terminal.getByText('0 nuevas · 0 duplicadas · 0 rechazadas')).toBeVisible();
  });

  test('las marcaciones descargadas se convierten en jornadas calculadas', async () => {
    await page.getByRole('link', { name: 'Asistencia' }).click();
    await page.getByLabel('Desde').fill(workedDay);
    await page.getByLabel('Hasta').fill(workedDay);

    // ON_TIME: everybody arrived within tolerance, so their day comes out as "Presente".
    const records = page.getByRole('row').filter({ hasText: 'Presente' });
    await expect(records.first()).toBeVisible();

    await page.getByRole('tab', { name: 'Marcaciones' }).click();
    await expect(page.getByRole('row').filter({ hasText: name }).first()).toBeVisible();
  });

  test('un equipo desconectado falla la sincronización y queda registrado', async () => {
    await page.getByRole('link', { name: 'Dispositivos' }).click();
    await terminal.getByRole('button', { name: 'Desconectar equipo' }).click();
    await expect(terminal.getByRole('button', { name: 'Reconectar equipo' })).toBeVisible();

    await terminal.getByRole('button', { name: 'Sincronizar' }).click();
    await expect(terminal.getByText(/Sincronización fallida/)).toBeVisible();
    await expect(terminal.getByText('Desconectado')).toBeVisible();
    await expect(
      card(page, 'Historial de sincronización').getByRole('row').filter({ hasText: name }).first(),
    ).toContainText('Fallida');

    // And it recovers as soon as the terminal is back on the network.
    await terminal.getByRole('button', { name: 'Reconectar equipo' }).click();
    await terminal.getByRole('button', { name: 'Probar conexión' }).click();
    await expect(terminal.getByText(/Conectado en \d+ ms/)).toBeVisible();
  });

  /**
   * Generates a full day of punches on a day the staff actually worked.
   *
   * It starts two days back and walks backwards: weekends and holidays produce no shifts,
   * and punches in the future are rejected by the ingestion pipeline, so generating "today"
   * would make the result depend on the hour the suite happens to run.
   */
  async function generateLastWorkedDay(): Promise<string> {
    for (let back = 2; back <= 9; back++) {
      const date = isoDaysAgo(back);
      await terminal.getByLabel('Fecha').fill(date);
      await terminal.getByRole('button', { name: 'Generar jornada' }).click();
      const generated = terminal.getByText(/Jornada generada: [1-9]\d* marcaciones/);
      const worked = await generated.waitFor({ state: 'visible', timeout: 5_000 }).then(
        () => true,
        () => false,
      );
      if (worked) return date;
    }
    throw new Error('No hubo ningún día laborable en los últimos 9 días');
  }
});

/** ISO date in the company timezone, which is the one the interface works with. */
function isoDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(date);
}
