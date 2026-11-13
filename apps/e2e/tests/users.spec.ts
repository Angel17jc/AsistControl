import { expect, test } from '@playwright/test';
import { ApiClient, USERS, chooseOwnPassword, logIn, signIn } from '../support/app';

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
  // Exact: the ways of first access also mention «correo».
  await form.getByLabel('Correo', { exact: true }).fill(email);
  await expect(form.getByLabel('Rol')).toHaveValue('EMPLOYEE');
  await form.getByPlaceholder('Buscar por nombre o código').fill(surname);
  await form.getByRole('button', { name: new RegExp(employee.name) }).click();
  // This server can email invitations (ADR 0016); this person gets a temporary password.
  await form.getByRole('radio', { name: /Darle una contraseña temporal/ }).check();
  await form.getByRole('button', { name: 'Generar' }).click();
  const password = await form.getByLabel('Contraseña inicial').inputValue();
  await form.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(form).toHaveCount(0);

  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toContainText('Empleado');
  await expect(row).toContainText(employee.name);
  await expect(row).toContainText('Activa');

  await expect(row).toContainText('Contraseña temporal');

  // The new account works: its owner replaces the given password and lands on their attendance.
  await page.getByRole('button', { name: 'Cerrar sesión' }).last().click();
  await logIn(page, email, password);
  await chooseOwnPassword(page, password, 'Clave-De-Ana-2026');
  await expect(page).toHaveURL(/\/asistencia$/);
  await expect(
    page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Usuarios' }),
  ).toHaveCount(0);
});

test('un administrador invita por correo y la cuenta espera a que la persona elija su contraseña', async ({
  page,
  request,
}) => {
  const api = await ApiClient.signIn(request, USERS.admin.email);
  const employee = await api.createEmployee('Invitada');
  const surname = employee.name.split(' ').at(-1)!;
  const email = `invitada-${surname}@e2e.local`;

  await signIn(page, USERS.admin);
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await page.getByRole('button', { name: 'Nueva cuenta' }).click();
  const form = page.getByRole('form', { name: 'Nueva cuenta' });
  await form.getByLabel('Correo', { exact: true }).fill(email);
  await form.getByPlaceholder('Buscar por nombre o código').fill(surname);
  await form.getByRole('button', { name: new RegExp(employee.name) }).click();
  await expect(
    form.getByRole('radio', { name: /Enviarle una invitación por correo/ }),
  ).toBeChecked();
  await expect(form.getByLabel('Contraseña inicial')).toHaveCount(0);
  await form.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.getByRole('status').first()).toContainText(`Invitación enviada a ${email}`);
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toContainText('Invitación enviada · vence el');
  await row.getByRole('button', { name: `Reenviar invitación a ${email}` }).click();
  await expect(row.getByRole('status')).toContainText('Invitación reenviada.');
});
