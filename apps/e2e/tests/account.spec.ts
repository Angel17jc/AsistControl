import { expect, test } from '@playwright/test';
import { ApiClient, USERS, signIn } from '../support/app';

const INITIAL = 'Clave-Inicial-2026';
const CHOSEN = 'Clave-Elegida-2026';

/**
 * Someone who received an initial password replaces it with their own, and from then on
 * only the new one opens the account.
 */
test('una persona cambia la contraseña que le dieron por una propia', async ({ page, request }) => {
  const admin = await ApiClient.signIn(request, USERS.admin.email);
  const account = await admin.createAccount('propia', INITIAL);

  await signIn(page, account, INITIAL);
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Mi cuenta' })).toBeVisible();

  const form = page.getByRole('form', { name: 'Cambiar contraseña' });
  await form.getByLabel('Contraseña actual').fill(INITIAL);
  await form.getByLabel('Nueva contraseña', { exact: true }).fill(CHOSEN);
  await form.getByLabel('Repita la nueva contraseña').fill(CHOSEN);
  await form.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(form.getByRole('status')).toContainText('Contraseña cambiada');

  await page.getByRole('button', { name: 'Cerrar sesión' }).last().click();
  await page.getByLabel('Correo electrónico').fill(account.email);
  await page.getByLabel('Contraseña').fill(INITIAL);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await signIn(page, account, CHOSEN);
});
