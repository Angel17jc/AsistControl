/**
 * A first check of an email address before asking the server, so a typo is pointed at its
 * field instead of coming back as a general error. The server validates again.
 * No regular expression on the address: a plain scan cannot backtrack on a long input.
 */
export function looksLikeEmail(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

/** What is wrong with an email field, in the words the forms use; null when it looks fine. */
export function emailProblem(value: string): string | null {
  if (!value) return 'Escriba su correo.';
  if (!looksLikeEmail(value)) return 'Revise el correo: debe tener la forma nombre@empresa.com.';
  return null;
}
