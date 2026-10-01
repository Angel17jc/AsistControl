/**
 * Account passwords: 10 to 128 characters with at least one letter and one number. The API
 * enforces it; the web checks it first so people learn before submitting. One definition,
 * so the two can never disagree. Anchored and bounded: linear time on any input.
 */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;

export function isStrongPassword(password: string): boolean {
  return PASSWORD_RULE.test(password);
}
