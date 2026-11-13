/** Joining words of Spanish surnames and names, written in lowercase inside a name. */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'do']);

/**
 * A first guess of names and surnames from the single name a terminal stores (often in
 * capitals): "MELANIE ANDREA ZAMBRANO PÉREZ" → Melanie Andrea / Zambrano Pérez. Ecuadorian
 * names usually carry two names and two surnames; with three words, one name and two
 * surnames is the likelier reading. HR confirms or corrects it before importing.
 */
export function splitDeviceName(raw: string): { firstName: string; lastName: string } {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const shout = raw === raw.toUpperCase() || raw === raw.toLowerCase();
  const cased = shout ? words.map((w, i) => titleWord(w, i)) : words;
  if (cased.length <= 1) return { firstName: cased[0] ?? '', lastName: '' };
  // Particles stick to the surname that follows them: "de la Cruz" is one surname.
  const names = cased.length >= 4 ? 2 : 1;
  let cut = names;
  while (cut > 1 && PARTICLES.has(cased[cut - 1]!.toLowerCase())) cut--;
  return { firstName: cased.slice(0, cut).join(' '), lastName: cased.slice(cut).join(' ') };
}

function titleWord(word: string, index: number): string {
  const lower = word.toLocaleLowerCase('es');
  if (index > 0 && PARTICLES.has(lower)) return lower;
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
}
