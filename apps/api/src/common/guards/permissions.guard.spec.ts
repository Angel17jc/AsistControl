import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission, Role } from '@asistcontrol/shared';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import { PermissionsGuard } from './permissions.guard';

function contextFor(
  role: Role | null,
  metadata: { permissions?: Permission[]; isPublic?: boolean },
): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(PERMISSIONS_KEY, metadata.permissions, handler);
  Reflect.defineMetadata(IS_PUBLIC_KEY, metadata.isPublic, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { id: 'u', role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows routes without permission requirements', () => {
    expect(guard.canActivate(contextFor('EMPLOYEE', {}))).toBe(true);
  });

  it('allows a role that holds the permission', () => {
    expect(guard.canActivate(contextFor('HR', { permissions: ['employees:write'] }))).toBe(true);
  });

  it('forbids a role without the permission', () => {
    expect(() =>
      guard.canActivate(contextFor('EMPLOYEE', { permissions: ['employees:write'] })),
    ).toThrow(ForbiddenException);
  });

  it('requires ALL listed permissions', () => {
    expect(() =>
      guard.canActivate(contextFor('HR', { permissions: ['employees:read', 'devices:write'] })),
    ).toThrow(ForbiddenException);
  });

  it('forbids when no user is attached', () => {
    expect(() => guard.canActivate(contextFor(null, { permissions: ['dashboard:read'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('skips public routes', () => {
    expect(
      guard.canActivate(contextFor(null, { isPublic: true, permissions: ['users:write'] })),
    ).toBe(true);
  });
});
