import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, hasPermission } from './rbac';
import { formatMinutes } from './time';

describe('RBAC matrix', () => {
  it('only references declared permissions', () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it('keeps employees away from administrative permissions', () => {
    expect(hasPermission('EMPLOYEE', 'employees:write')).toBe(false);
    expect(hasPermission('EMPLOYEE', 'devices:read')).toBe(false);
    expect(hasPermission('EMPLOYEE', 'attendance:read')).toBe(true);
  });

  it('does not allow HR to manage users or devices', () => {
    expect(hasPermission('HR', 'users:write')).toBe(false);
    expect(hasPermission('HR', 'devices:write')).toBe(false);
  });
});

describe('formatMinutes', () => {
  it.each([
    [0, '0h 00m'],
    [424, '7h 04m'],
    [-5, '0h 00m'],
    [61, '1h 01m'],
  ])('%i -> %s', (input, expected) => expect(formatMinutes(input)).toBe(expected));
});
