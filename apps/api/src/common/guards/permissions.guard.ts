import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Permission, hasPermission } from '@asistcontrol/shared';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';

/** Enforces @RequirePermissions() against the role → permission matrix. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException();

    const missing = required.filter((p) => !hasPermission(user.role, p));
    if (missing.length > 0) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
