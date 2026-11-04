import { expect, test } from '@playwright/test';
import { USERS, signIn } from '../support/app';

/**
 * People read errors in Spanish, whatever went wrong: the API refusing something, the server
 * out of reach or the network gone. These run against the real API on purpose: a mocked
 * response would only prove that the mock and the translation agree.
 */
test.describe('Errores en palabras de quien usa la aplicación', () => {
  test('un inicio de sesión rechazado se explica', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo').fill(USERS.hr.email);
    await page.getByLabel('Contraseña').fill('una-clave-equivocada');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
  });

  test('un empleado inválido o repetido dice qué corregir', async ({ page }) => {
    await signIn(page, USERS.hr);
    await page.getByRole('link', { name: 'Empleados' }).click();
    await page.getByRole('button', { name: 'Nuevo empleado' }).click();
    const form = page.getByRole('form', { name: 'Nuevo empleado' });
    await form.getByLabel('Nombres').fill('Prueba');
    await form.getByLabel('Apellidos').fill('Errores');

    await form.getByLabel('Código interno').fill('EMP 001');
    await form.getByLabel('Identificación').fill('12');
    await form.getByRole('button', { name: 'Guardar' }).click();
    const alert = form.getByRole('alert');
    await expect(alert).toContainText('Código interno: use de 2 a 20 letras');
    await expect(alert).toContainText('Identificación: use de 5 a 20 letras');

    // The first row is an employee that exists: its code is taken.
    const taken = await page.getByRole('row').nth(1).getByRole('cell').first().innerText();
    await form.getByLabel('Código interno').fill(taken);
    await form.getByLabel('Identificación').fill(`QA${Date.now().toString().slice(-8)}`);
    await form.getByRole('button', { name: 'Guardar' }).click();
    await expect(alert).toHaveText('Ya hay otro registro con el mismo valor en «Código interno».');
  });

  test('guardar sin red avisa en vez de quedarse esperando', async ({ page, context }) => {
    await signIn(page, USERS.hr);
    await page.getByRole('link', { name: 'Horarios' }).click();
    await page.getByRole('button', { name: /Nuevo turno/ }).click();
    const form = page.getByRole('form', { name: 'Nuevo turno' });
    await form.getByLabel('Nombre').fill('Sin red');
    await form.getByLabel('Entrada', { exact: true }).fill('08:00');
    await form.getByLabel('Salida', { exact: true }).fill('17:00');

    // By default the query library would pause the request and the button would spin forever.
    await context.setOffline(true);
    await form.getByRole('button', { name: 'Crear turno' }).click();
    await expect(form.getByRole('alert')).toContainText('No se pudo conectar con el servidor');
    await context.setOffline(false);
  });

  test('un corte no borra lo que se ve, y al volver se recupera solo', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, USERS.admin);
    await expect(page.getByText('Últimas marcaciones')).toBeVisible();

    const reconnect = async () => {
      // Only stale data is refetched on reconnect: staleTime is 15 s.
      await page.waitForTimeout(16_000);
      await context.setOffline(true);
      await page.waitForTimeout(1_000);
      await context.setOffline(false);
    };

    await page.route('**/api/dashboard/**', (route) => route.abort());
    await reconnect();
    await expect(page.getByRole('alert')).toContainText('No se pudo conectar con el servidor');
    await expect(page.getByText('Últimas marcaciones')).toBeVisible();

    await page.unroute('**/api/dashboard/**');
    await reconnect();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Últimas marcaciones')).toBeVisible();
  });

  test('una cuenta sin empleado no recibe un formulario que no puede usar', async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.getByRole('link', { name: 'Solicitudes' }).click();
    await expect(page.getByRole('heading', { name: 'Solicitudes', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Solicitar permiso' })).toHaveCount(0);
  });
});
