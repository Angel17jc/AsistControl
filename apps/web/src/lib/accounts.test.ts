import { isStrongPassword } from '@asistcontrol/shared';
import { describe, expect, it } from 'vitest';
import { canManageAccount, generatePassword, grantableRoles, needsEmployee } from './accounts';

describe('accounts', () => {
  it('lets only a super admin grant administrator roles', () => {
    expect(grantableRoles('SUPER_ADMIN')).toEqual([
      'SUPER_ADMIN',
      'ADMIN',
      'HR',
      'SUPERVISOR',
      'EMPLOYEE',
    ]);
    expect(grantableRoles('ADMIN')).toEqual(['HR', 'SUPERVISOR', 'EMPLOYEE']);
  });

  it('lets only a super admin manage administrator accounts', () => {
    expect(canManageAccount('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageAccount('ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canManageAccount('ADMIN', 'HR')).toBe(true);
    expect(canManageAccount('SUPER_ADMIN', 'ADMIN')).toBe(true);
  });

  it('requires an employee for supervisors and employees only', () => {
    expect(needsEmployee('EMPLOYEE')).toBe(true);
    expect(needsEmployee('SUPERVISOR')).toBe(true);
    expect(needsEmployee('HR')).toBe(false);
  });

  it('generates passwords the API accepts, without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword();
      expect(password).toHaveLength(14);
      expect(isStrongPassword(password)).toBe(true);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it('skips the random bytes that would bias the alphabet', () => {
    // 57 characters: bytes from 228 (= 4 × 57) up would favour the first ones, so they are
    // skipped; 227 is the last one kept and maps to the last character.
    const bytes = [255, 228, 227, 0, 49, 0, 49, 0, 49, 0, 49, 0];
    const random = () => new Uint8Array([bytes.shift() ?? 0]);
    expect(generatePassword(10, random)).toBe('9a2a2a2a2a');
  });
});
