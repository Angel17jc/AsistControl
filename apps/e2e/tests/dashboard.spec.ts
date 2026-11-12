import { expect, test } from '@playwright/test';
import { USERS, card, signIn } from '../support/app';

/**
 * Layout only a browser can measure. At 1280 px "Asistencia de hoy" shares its row with the
 * hourly chart, and a legend split into five equal columns put one entry's icon over the
 * previous entry's count.
 */
test('la leyenda de «Asistencia de hoy» se lee completa', async ({ page }) => {
  await signIn(page, USERS.admin);
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

  const items = card(page, 'Asistencia de hoy').getByRole('listitem');
  await expect(items).toHaveCount(5);
  const boxes = await items.evaluateAll((lis) =>
    lis.map((li) => {
      const { left, right, top, bottom } = li.getBoundingClientRect();
      const text = li.querySelector('span')?.textContent ?? '';
      return { text, left, right, top, bottom, spills: li.scrollWidth > li.clientWidth };
    }),
  );

  for (const [i, box] of boxes.entries()) {
    expect(box.spills, `«${box.text}» no cabe en su lugar`).toBe(false);
    for (const other of boxes.slice(i + 1)) {
      const overlap =
        box.left < other.right &&
        other.left < box.right &&
        box.top < other.bottom &&
        other.top < box.bottom;
      expect(overlap, `«${box.text}» se monta sobre «${other.text}»`).toBe(false);
    }
  }
});
