import { PRIVILEGED_ROLES, ROLES, type Role, SCOPED_ROLES } from '@asistcontrol/shared';

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super administrador',
  ADMIN: 'Administrador',
  HR: 'Talento humano',
  SUPERVISOR: 'Supervisor',
  EMPLOYEE: 'Empleado',
};

/**
 * The UI offers only what the API will accept (UsersService): administrator roles are
 * granted, and administrator accounts managed, by a super admin alone.
 */
export function grantableRoles(actor: Role): Role[] {
  return actor === 'SUPER_ADMIN' ? [...ROLES] : ROLES.filter((r) => !PRIVILEGED_ROLES.includes(r));
}

export function canManageAccount(actor: Role, target: Role): boolean {
  return actor === 'SUPER_ADMIN' || !PRIVILEGED_ROLES.includes(target);
}

/** A supervisor or an employee sees data through their linked employee: one is required. */
export function needsEmployee(role: Role): boolean {
  return SCOPED_ROLES.includes(role);
}

/** No 0/O, 1/l/I: an initial password is often read aloud or copied by hand. */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A random initial password that satisfies the shared rule (letters and numbers, 10+ chars).
 * Uses the browser's CSPRNG; rejection sampling keeps every character equally likely.
 */
export function generatePassword(length = 14, random = defaultRandom): string {
  for (;;) {
    let password = '';
    while (password.length < length) {
      const [byte] = random(1);
      // 256 is not a multiple of the alphabet size: skip the bytes that would bias it.
      if (byte! < 256 - (256 % ALPHABET.length)) password += ALPHABET[byte! % ALPHABET.length];
    }
    if (/[A-Za-z]/.test(password) && /\d/.test(password)) return password;
  }
}

function defaultRandom(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}
