import { type Page, expect, test } from '@playwright/test';
import { ApiClient, USERS, signIn } from '../support/app';

/**
 * A terminal goes down while an administrator has the app open: the bell counts it at once,
 * with no reload, and following the notification leads to the page where it can be fixed.
 */
test('la campana avisa en vivo de un equipo caído y lleva a resolverlo', async ({
  page,
  request,
}) => {
  const api = await ApiClient.signIn(request, USERS.admin.email);
  const device = await api.createMockDevice('Terminal vigilado');
  await api.sync(device.id); // it has worked at least once, so going down is news

  await signIn(page, USERS.admin);
  // Earlier tests may have left notifications: work with the difference, not absolutes.
  const before = await unreadCount(page);

  await api.setOnline(device.id, false);
  await api.sync(device.id);
  await api.sync(device.id); // still down: one incident, one notification

  await expect.poll(() => unreadCount(page), { timeout: 15_000 }).toBe(before + 1);

  await bell(page).click();
  const panel = page.getByRole('dialog', { name: 'Notificaciones' });
  const item = panel.getByRole('button').filter({ hasText: device.name }).first();
  await expect(item).toContainText('Dispositivo sin conexión');
  await expect(item).toContainText('Sin respuesta del equipo');

  await item.click();
  await expect(page).toHaveURL(/\/dispositivos$/);
  await expect(panel).toHaveCount(0);
  await expect.poll(() => unreadCount(page)).toBe(before);

  // And it comes back: a second, good piece of news.
  await api.setOnline(device.id, true);
  await api.sync(device.id);
  await expect.poll(() => unreadCount(page), { timeout: 15_000 }).toBe(before + 1);

  await bell(page).click();
  await expect(panel.getByRole('button').filter({ hasText: device.name }).first()).toContainText(
    'Dispositivo en línea de nuevo',
  );
  await panel.getByRole('button', { name: 'Marcar todas como leídas' }).click();
  await expect(bell(page)).toHaveAccessibleName('Notificaciones');
});

function bell(page: Page) {
  return page.getByRole('button', { name: /^Notificaciones/ });
}

async function unreadCount(page: Page): Promise<number> {
  const name = (await bell(page).getAttribute('aria-label')) ?? '';
  return Number(/(\d+) sin leer/.exec(name)?.[1] ?? 0);
}
