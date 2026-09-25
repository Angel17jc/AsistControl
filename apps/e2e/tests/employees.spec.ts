import { expect, test } from '@playwright/test';
import { USERS, signIn } from '../support/app';

/**
 * An employee's working life from HR's desk: hired, corrected, terminated and reinstated.
 * The test creates its own employee, so it never touches the seeded ones.
 */
test('RRHH da de alta, corrige, da de baja y reincorpora a un empleado', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const code = `QA-${suffix}`;

  await signIn(page, USERS.hr);
  await page.getByRole('link', { name: 'Empleados' }).click();

  await page.getByRole('button', { name: 'Nuevo empleado' }).click();
  const create = page.getByRole('form', { name: 'Nuevo empleado' });
  await create.getByLabel('Código interno').fill(code);
  await create.getByLabel('Identificación').fill(`QA${suffix}`);
  await create.getByLabel('Nombres').fill('Prueba');
  await create.getByLabel('Apellidos').fill(`Ingreso ${suffix}`);
  await create.getByRole('button', { name: 'Guardar' }).click();
  await expect(create).toHaveCount(0);

  await page.getByLabel('Buscar empleado').fill(code);
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toContainText('Activo');

  // A correction: the first name was wrong and the department was missing.
  await row.getByRole('button', { name: `Editar Prueba Ingreso ${suffix}` }).click();
  let edit = page.getByRole('form', { name: `Editar Prueba Ingreso ${suffix}` });
  await edit.getByLabel('Nombres').fill('Probada');
  await edit.getByLabel('Departamento').selectOption({ label: 'Operaciones' });
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(edit).toHaveCount(0);
  await expect(row).toContainText(`Ingreso ${suffix} Probada`);
  await expect(row).toContainText('Operaciones');

  // Termination.
  await row.getByRole('button', { name: `Editar Probada Ingreso ${suffix}` }).click();
  edit = page.getByRole('form', { name: `Editar Probada Ingreso ${suffix}` });
  await edit.getByLabel('Estado').selectOption('INACTIVE');
  await edit.getByLabel('Fecha de baja').fill('2026-12-31');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(row).toContainText('Inactivo');

  // Reinstatement: back to active, and the termination date goes with it.
  await row.getByRole('button', { name: `Editar Probada Ingreso ${suffix}` }).click();
  edit = page.getByRole('form', { name: `Editar Probada Ingreso ${suffix}` });
  await expect(edit.getByLabel('Fecha de baja')).toHaveValue('2026-12-31');
  await edit.getByLabel('Estado').selectOption('ACTIVE');
  await expect(edit.getByLabel('Fecha de baja')).toHaveValue('');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(row).toContainText('Activo');

  await row.getByRole('button', { name: `Editar Probada Ingreso ${suffix}` }).click();
  edit = page.getByRole('form', { name: `Editar Probada Ingreso ${suffix}` });
  await expect(edit.getByLabel('Fecha de baja')).toHaveValue('');
});
