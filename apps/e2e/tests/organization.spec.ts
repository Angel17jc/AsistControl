import { expect, test } from '@playwright/test';
import { USERS, card, signIn } from '../support/app';

/**
 * Talent management opens a new area and fills it: the department is created on the
 * Organization page, offered by the employee form and, once someone belongs, kept from
 * being deleted. The test creates its own department and employee.
 */
test('RRHH crea un departamento, lo asigna y ya no se puede eliminar', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const name = `Bodega ${suffix}`;

  await signIn(page, USERS.hr);
  await page.getByRole('link', { name: 'Organización' }).click();
  const departments = card(page, 'Departamentos');
  await departments.getByRole('button', { name: 'Nuevo departamento' }).click();
  const form = departments.getByRole('form', { name: 'Nuevo departamento' });
  await form.getByLabel('Código').fill(`bod-${suffix}`);
  await form.getByLabel('Nombre').fill(name);
  await form.getByRole('button', { name: 'Crear' }).click();
  await expect(form).toHaveCount(0);

  const row = departments.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText(`BOD-${suffix}`);
  await expect(row.getByRole('button', { name: `Eliminar ${name}` })).toBeVisible();

  await page.getByRole('link', { name: 'Empleados' }).click();
  await page.getByRole('button', { name: 'Nuevo empleado' }).click();
  const hire = page.getByRole('form', { name: 'Nuevo empleado' });
  await hire.getByLabel('Código interno').fill(`QA-${suffix}`);
  await hire.getByLabel('Identificación').fill(`QA${suffix}`);
  await hire.getByLabel('Nombres').fill('Prueba');
  await hire.getByLabel('Apellidos').fill(`Bodega ${suffix}`);
  await hire.getByLabel('Departamento').selectOption({ label: name });
  await hire.getByRole('button', { name: 'Guardar' }).click();
  await expect(hire).toHaveCount(0);

  await page.getByRole('link', { name: 'Organización' }).click();
  await expect(row.getByRole('cell').nth(3)).toHaveText('1');
  await expect(row.getByRole('button', { name: `Eliminar ${name}` })).toHaveCount(0);
});
