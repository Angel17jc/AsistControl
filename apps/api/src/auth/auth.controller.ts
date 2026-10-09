import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthSession } from '@asistcontrol/shared';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { CurrentUser, Public, ReqContext } from '../common/decorators';
import { AppConfigService } from '../config/app-config.service';
import { AuthService, type IssuedSession } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

export const REFRESH_COOKIE = 'ac_refresh';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Brute-force protection on top of the global limit: 5 attempts per minute per IP.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'Returns a short-lived access token. The refresh token is set as an httpOnly cookie.',
  })
  @ApiOkResponse({ description: 'Authenticated' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  async login(
    @Body() dto: LoginDto,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.respond(res, await this.auth.login(dto.email, dto.password, ctx));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh cookie and obtain a new access token' })
  async refresh(
    @Req() req: Request,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    try {
      return this.respond(res, await this.auth.refresh(token, ctx));
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user, ctx);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Proving the current password is a login: same brute-force limit.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change your own password',
    description:
      'Requires the current password. Every other session of the account is revoked; this one stays.',
  })
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiForbiddenResponse({ description: 'The current password is wrong' })
  @ApiBadRequestResponse({ description: 'The new password is weak or equal to the current one' })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword, ctx);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user profile' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  private respond(res: Response, issued: IssuedSession): AuthSession {
    res.cookie(REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieOptions(),
      expires: issued.refreshExpiresAt,
    });
    return { accessToken: issued.accessToken, expiresIn: issued.expiresIn, user: issued.user };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE'),
      sameSite: 'strict',
      path: '/api/auth',
    };
  }
}
