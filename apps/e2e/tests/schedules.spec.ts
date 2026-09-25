import { expect, test } from '@playwright/test';
import { ApiClient, USERS, card, signIn } from '../support/app';

/**
 * HR gives a new hire a schedule, plans a change and takes it back after picking the wrong one.
 * The test creates its own employee, so the seeded histories stay as they are.
 */
test('RRHH asigna un horario, programa un cambio y lo deshace', async ({ page, request }) => {
  const api = await ApiClient.signIn(request, USERS.hr.email);
  const employee = await api.createEmployee('Horario');

  await signIn(page, USERS.hr);
  await page.getByRole('link', { name: 'Empleados' }).click();
  await page.getByLabel('Buscar empleado').fill(employee.name.split(' ').at(-1)!);
  await page.getByRole('button', { name: `Horario de ${employee.name}` }).click();

  const panel = card(page, `Horario de ${employee.name}`);
  await expect(panel.getByText('Sin horario asignado')).toBeVisible();

  // From today: the schedule is in force straight away.
  const form = panel.getByRole('form', { name: 'Asignar horario' });
  await form.getByLabel('Nuevo horario').selectOption({ label: 'Administrativo L-V' });
  await expect(form.getByText('lun–vie 08:00–17:00')).toBeVisible();
  await form.getByRole('button', { name: 'Asignar' }).click();

  const history = panel.getByRole('list', { name: 'Historial de horarios' });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history.getByRole('listitem').first()).toContainText('Vigente');

  // A change planned for later, with the wrong schedule…
  await form.getByLabel('Nuevo horario').selectOption({ label: 'Vigilancia nocturna L-V' });
  await form.getByLabel('Desde').fill('2099-01-05');
  await form.getByRole('button', { name: 'Asignar' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('Programado');
  await expect(history.getByRole('listitem').first()).toContainText('desde 5 ene 2099');

  // …is taken back, and the current schedule runs open-ended again.
  await panel.getByRole('button', { name: 'Deshacer último cambio' }).click();
  await panel.getByRole('button', { name: 'Sí, deshacer' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history.getByRole('listitem').first()).toContainText('Administrativo L-V');
  await expect(history.getByRole('listitem').first()).toContainText('desde');
});
