import { FakeHikvisionDevice, formatLocalIso } from '@asistcontrol/biometric-core';
import { type Page, expect, test } from '@playwright/test';
import { USERS, card, signIn } from '../support/app';

/**
 * A Hikvision terminal registered from the interface, credentials included, and reached for
 * real: browser → API → HTTP with Digest authentication → a fake terminal speaking ISAPI,
 * running inside this test process.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Terminal Hikvision', () => {
  const PASSWORD = 'Hik12345!';
  const terminals: FakeHikvisionDevice[] = [];
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signIn(page, USERS.admin);
  });

  test.afterAll(async () => {
    await page.close();
    await Promise.all(terminals.map((terminal) => terminal.close()));
  });

  /** A terminal of its own: the API refuses two devices on the same address and port. */
  async function startTerminal(): Promise<number> {
    const terminal = new FakeHikvisionDevice({
      password: PASSWORD,
      // One face punch half an hour ago by the seeded employee with biometric id 1001.
      events: [
        {
          serialNo: 1,
          employeeNo: '1001',
          time: formatLocalIso(new Date(Date.now() - 30 * 60_000), 'America/Guayaquil'),
          attendanceStatus: 'checkIn',
        },
      ],
    });
    terminals.push(terminal);
    return terminal.listen();
  }

  async function register(name: string, port: number, password: string) {
    await page.getByRole('link', { name: 'Dispositivos' }).click();
    await page.getByRole('button', { name: 'Registrar dispositivo' }).click();
    const form = page.getByRole('form', { name: 'Registrar dispositivo' });
    await form.getByLabel('Driver').selectOption('HIKVISION');
    await form.getByLabel('Nombre').fill(name);
    await form.getByLabel('IP / host').fill('127.0.0.1');
    await form.getByLabel('Puerto').fill(String(port));
    await form.getByLabel('Usuario ISAPI').fill('admin');
    await form.getByLabel('Contraseña ISAPI').fill(password);
    await form.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(form).toHaveCount(0);
    return card(page, name);
  }

  test('se registra con sus credenciales y descarga las marcaciones', async () => {
    const name = `Acceso Hikvision ${Date.now().toString().slice(-6)}`;
    const port = await startTerminal();
    const device = await register(name, port, PASSWORD);
    await expect(device).toContainText(`127.0.0.1:${port}`);
    await expect(device).toContainText('HIKVISION');

    await device.getByRole('button', { name: 'Probar conexión' }).click();
    await expect(device.getByText(/Conectado en \d+ ms/)).toBeVisible();
    await expect(device.getByText('En línea', { exact: true })).toBeVisible();

    await device.getByRole('button', { name: 'Sincronizar' }).click();
    await expect(device.getByText('1 nuevas · 0 duplicadas · 0 rechazadas')).toBeVisible();

    // The password went to the API once; nothing on the page shows it back.
    expect(await page.content()).not.toContain(PASSWORD);
  });

  test('explica una contraseña rechazada en lugar de culpar a la red', async () => {
    const name = `Hikvision mal configurado ${Date.now().toString().slice(-6)}`;
    const device = await register(name, await startTerminal(), 'contrasena-equivocada');

    await device.getByRole('button', { name: 'Probar conexión' }).click();
    await expect(
      device.getByText(/No se pudo conectar\. El equipo rechazó las credenciales/),
    ).toBeVisible();
    await expect(device.getByText('Error', { exact: true })).toBeVisible();
  });
});
