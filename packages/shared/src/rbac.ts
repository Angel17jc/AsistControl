/**
 * Role-based access control matrix.
 * Roles are fixed and permissions are code-defined (see docs/adr/0003-rbac-in-code.md).
 * The API enforces them; the web client only uses them to hide UI the user cannot use.
 */
export const ROLES = Object.freeze([
  'SUPER_ADMIN',
  'ADMIN',
  'HR',
  'SUPERVISOR',
  'EMPLOYEE',
] as const);
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = Object.freeze([
  'dashboard:read',
  'users:read',
  'users:write',
  'employees:read',
  'employees:write',
  'organization:read',
  'organization:write',
  'schedules:read',
  'schedules:write',
  'attendance:read',
  'attendance:write',
  'devices:read',
  'devices:write',
  'devices:sync',
  'leave:read',
  'leave:request',
  'leave:approve',
  'overtime:read',
  'overtime:approve',
  'reports:read',
  'audit:read',
  'settings:read',
  'settings:write',
] as const);
export type Permission = (typeof PERMISSIONS)[number];

const HR_PERMISSIONS: readonly Permission[] = [
  'dashboard:read',
  'employees:read',
  'employees:write',
  'organization:read',
  'organization:write',
  'schedules:read',
  'schedules:write',
  'attendance:read',
  'attendance:write',
  'devices:read',
  'leave:read',
  'leave:request',
  'leave:approve',
  'overtime:read',
  'overtime:approve',
  'reports:read',
  'settings:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: PERMISSIONS,
  HR: HR_PERMISSIONS,
  SUPERVISOR: [
    'dashboard:read',
    'employees:read',
    'attendance:read',
    'leave:read',
    'leave:request',
    'leave:approve',
    'overtime:read',
    'overtime:approve',
  ],
  EMPLOYEE: ['attendance:read', 'leave:read', 'leave:request', 'overtime:read'],
});

/**
 * Roles whose data access is restricted to a subset of employees.
 * SUPERVISOR: self + direct reports. EMPLOYEE: self only.
 */
export const SCOPED_ROLES: readonly Role[] = ['SUPERVISOR', 'EMPLOYEE'];

/** Roles that only a SUPER_ADMIN may grant. */
export const PRIVILEGED_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN'];

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
