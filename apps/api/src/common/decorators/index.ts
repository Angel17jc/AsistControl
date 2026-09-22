import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Permission } from '@asistcontrol/shared';
import type { Request } from 'express';
import type { AuthenticatedUser, RequestContext } from '../auth/authenticated-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

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
