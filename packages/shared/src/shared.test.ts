import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, hasPermission, rolesWith } from './rbac';
import { NOTIFICATION_TYPES } from './domain';
import { notificationTypesFor } from './notifications';
import { isStrongPassword } from './passwords';
import { formatMinutes } from './time';

describe('RBAC matrix', () => {
  it('only references declared permissions', () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it('lists the roles holding a permission, straight from the matrix', () => {
    expect(rolesWith('devices:sync').sort()).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect(rolesWith('leave:approve').sort()).toEqual(['ADMIN', 'HR', 'SUPERVISOR', 'SUPER_ADMIN']);
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

describe('notification audience', () => {
  it('offers each role only the notifications it can receive', () => {
    expect(notificationTypesFor('EMPLOYEE')).toEqual(['LEAVE_REVIEWED', 'VACATION_EXPIRING']);
    expect(notificationTypesFor('SUPERVISOR')).toEqual([
      'LEAVE_REQUESTED',
      'LEAVE_REVIEWED',
      'VACATION_EXPIRING',
    ]);
    // HR approves leave but cannot act on devices, so it never hears about outages.
    expect(notificationTypesFor('HR')).not.toContain('DEVICE_DOWN');
    expect(notificationTypesFor('ADMIN')).toEqual([...NOTIFICATION_TYPES]);
  });
});

describe('password rule', () => {
  it('needs 10 to 128 characters with a letter and a number', () => {
    expect(isStrongPassword('Asist2026Control')).toBe(true);
    expect(isStrongPassword('corta12')).toBe(false);
    expect(isStrongPassword('sololetrasaqui')).toBe(false);
    expect(isStrongPassword('1234567890')).toBe(false);
    expect(isStrongPassword(`a1${'x'.repeat(126)}`)).toBe(true);
    expect(isStrongPassword(`a1${'x'.repeat(127)}`)).toBe(false);
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
