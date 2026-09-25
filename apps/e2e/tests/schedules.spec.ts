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

/**
 * The building blocks, from HR's desk: a shift, a weekly schedule made of it, and a holiday.
 * Names carry a suffix so reruns against the same database never collide.
 */
test('RRHH crea un turno, un horario semanal y un feriado', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  await signIn(page, USERS.hr);
  await page.getByRole('link', { name: 'Horarios' }).click();
  await expect(page.getByRole('heading', { name: 'Horarios', level: 1 })).toBeVisible();

  // A shift that crosses midnight.
  await page.getByRole('button', { name: 'Nuevo turno' }).click();
  const shiftForm = page.getByRole('form', { name: 'Nuevo turno' });
  await shiftForm.getByLabel('Nombre', { exact: true }).fill(`Madrugada ${suffix}`);
  await shiftForm.getByLabel('Entrada', { exact: true }).fill('23:00');
  await shiftForm.getByLabel('Salida', { exact: true }).fill('07:00');
  await shiftForm.getByRole('button', { name: 'Crear turno' }).click();
  await expect(shiftForm).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: `Madrugada ${suffix}` })).toContainText(
    '23:00–07:00 (+1 día)',
  );

  // A weekend schedule built from it.
  await page.getByRole('button', { name: 'Nuevo horario' }).click();
  const scheduleForm = page.getByRole('form', { name: 'Nuevo horario' });
  await scheduleForm.getByLabel('Nombre', { exact: true }).fill(`Fin de semana ${suffix}`);
  for (const day of ['Sábado', 'Domingo']) {
    await scheduleForm
      .getByLabel(day)
      .selectOption({ label: `Madrugada ${suffix} · 23:00–07:00 (+1 día)` });
  }
  await scheduleForm.getByRole('button', { name: 'Crear horario' }).click();
  await expect(scheduleForm).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: `Fin de semana ${suffix}` })).toContainText(
    'sáb y dom 23:00–07:00',
  );

  // A holiday this year (1-20 December: the seed has Christmas), removed again so reruns start clean.
  const year = new Date().getFullYear();
  const day = String((Number(suffix) % 20) + 1).padStart(2, '0');
  const holidayForm = page.getByRole('form', { name: 'Nuevo feriado' });
  await holidayForm.getByLabel('Fecha').fill(`${year}-12-${day}`);
  await holidayForm.getByLabel('Nombre del feriado').fill(`Feriado QA ${suffix}`);
  await holidayForm.getByRole('button', { name: 'Añadir' }).click();
  const holiday = page.getByRole('row').filter({ hasText: `Feriado QA ${suffix}` });
  await expect(holiday).toContainText(`${Number(day)} dic ${year}`);
  await holiday.getByRole('button', { name: `Eliminar feriado Feriado QA ${suffix}` }).click();
  await expect(holiday).toHaveCount(0);
});
