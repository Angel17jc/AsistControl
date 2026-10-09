import { expect, test } from '@playwright/test';
import { USERS, signIn } from '../support/app';

/**
 * An administrator adjusts a labor rule, finds it still there after reloading and applies it
 * to days already computed. The rule is put back at the end: the policy is shared by every
 * other test.
 */
test('un administrador ajusta una regla de asistencia y recalcula', async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.getByRole('link', { name: 'Configuración' }).click();

  const rules = page.getByRole('form', { name: 'Reglas de asistencia' });
  const minBreak = rules.getByLabel('Almuerzo mínimo (min)');
  const original = await minBreak.inputValue();
  const changed = original === '25' ? '30' : '25';

  const setMinBreak = async (value: string) => {
    await minBreak.fill(value);
    await rules.getByRole('button', { name: 'Guardar reglas' }).click();
    await expect(rules.getByRole('status')).toContainText('Reglas guardadas');
  };

  const recompute = page.getByRole('form', { name: 'Recalcular jornadas' });
  // Waits for the request itself: the message of an earlier run may still be on screen.
  const recomputeMonth = async () => {
    const done = page.waitForResponse(
      (res) => res.url().endsWith('/api/attendance/recompute') && res.ok(),
    );
    await recompute.getByRole('button', { name: 'Recalcular' }).click();
    await done;
    await expect(recompute.getByRole('status')).toContainText(/Se recalcularon \d+ jornadas/);
  };

  await setMinBreak(changed);
  try {
    await page.reload();
    await expect(minBreak).toHaveValue(changed);
    await recomputeMonth();
  } finally {
    // Leave the days as the other tests expect them: original rule, recomputed.
    await setMinBreak(original);
    await recomputeMonth();
  }
});
