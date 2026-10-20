import { expect, test } from '@playwright/test';
import { ApiClient, USERS, chooseOwnPassword, logIn, signIn } from '../support/app';

const GIVEN = 'Clave-Inicial-2026';
const CHOSEN = 'Clave-Elegida-2026';
const LATER = 'Clave-Posterior-2026';

/**
 * Someone receives a password from an administrator. The first sign-in asks for their own
 * before anything else; from then on only theirs opens the account, and they can change it
 * again from My account.
 */
test('una persona reemplaza la contraseña que le dieron y luego la cambia', async ({
  page,
  request,
}) => {
  const admin = await ApiClient.signIn(request, USERS.admin.email);
  const account = await admin.createAccount('propia', GIVEN);

  await logIn(page, account.email, GIVEN);
  await chooseOwnPassword(page, GIVEN, CHOSEN);

  // The given password no longer opens the account.
  await page.getByRole('button', { name: 'Cerrar sesión' }).last().click();
  await logIn(page, account.email, GIVEN);
  await expect(page.getByRole('alert')).toBeVisible();

  // Theirs does, straight into the app; and they can change it again whenever they want.
  await signIn(page, account, CHOSEN);
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  const form = page.getByRole('form', { name: 'Cambiar contraseña' });
  await form.getByLabel('Contraseña actual').fill(CHOSEN);
  await form.getByLabel('Nueva contraseña', { exact: true }).fill(LATER);
  await form.getByLabel('Repita la nueva contraseña').fill(LATER);
  await form.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(form.getByRole('status')).toContainText('Contraseña cambiada');
});
