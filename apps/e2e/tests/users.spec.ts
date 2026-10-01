import { expect, test } from '@playwright/test';
import { ApiClient, USERS, signIn } from '../support/app';

/**
 * The reason the Users page exists: an administrator gives a new hire an account, and that
 * person can sign in and see their own attendance. The test creates its own employee.
 */
test('un administrador crea la cuenta de un empleado y esa persona puede entrar', async ({
  page,
  request,
}) => {
  const api = await ApiClient.signIn(request, USERS.admin.email);
  const employee = await api.createEmployee('Acceso');
  const surname = employee.name.split(' ').at(-1)!;
  const email = `acceso-${surname}@e2e.local`;

  await signIn(page, USERS.admin);
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await page.getByRole('button', { name: 'Nueva cuenta' }).click();

  const form = page.getByRole('form', { name: 'Nueva cuenta' });
  await form.getByLabel('Correo').fill(email);
  await expect(form.getByLabel('Rol')).toHaveValue('EMPLOYEE');
  await form.getByPlaceholder('Buscar por nombre o código').fill(surname);
  await form.getByRole('button', { name: new RegExp(employee.name) }).click();
  await form.getByRole('button', { name: 'Generar' }).click();
  const password = await form.getByLabel('Contraseña inicial').inputValue();
  await form.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(form).toHaveCount(0);

  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toContainText('Empleado');
  await expect(row).toContainText(employee.name);
  await expect(row).toContainText('Activa');

  // The new account works: its owner signs in and lands on their own attendance.
  await page.getByRole('button', { name: 'Cerrar sesión' }).last().click();
  await signIn(page, { email }, password);
  await expect(page).toHaveURL(/\/asistencia$/);
  await expect(
    page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Usuarios' }),
  ).toHaveCount(0);
});
