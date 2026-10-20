import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Permission } from '@asistcontrol/shared';
import type { Request } from 'express';
import type { AuthenticatedUser, RequestContext } from '../auth/authenticated-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';
export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPasswordChange';

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Keeps a route open to someone who must still replace the password an administrator gave
 * them. Every other route answers 403 until they do.
 */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

/** The user must hold ALL listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>().user;
  },
);

export const ReqContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
  },
);
