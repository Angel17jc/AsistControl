import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
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
import type { AuthOptions, AuthSession, PasswordLinkInfo } from '@asistcontrol/shared';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { AllowPendingPasswordChange, CurrentUser, Public, ReqContext } from '../common/decorators';
import { AppConfigService } from '../config/app-config.service';
import { AuthService, type IssuedSession } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, PasswordLinkDto, ResetPasswordDto } from './dto/password-links.dto';
import { PasswordLinksService } from './password-links.service';

export const REFRESH_COOKIE = 'ac_refresh';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly links: PasswordLinksService,
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
  @AllowPendingPasswordChange()
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
  @AllowPendingPasswordChange()
  // Proving the current password is a login: same brute-force limit.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change your own password',
    description:
      'Requires the current password. Every other session of the account is revoked; this one stays. ' +
      'Clears mustChangePassword: refresh the session afterwards to get a token without it.',
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

  @Public()
  @Get('options')
  @ApiOperation({
    summary: 'What the sign-in page may offer',
    description: 'passwordLinks: "forgot password" and invitations can reach people (ADR 0016).',
  })
  options(): AuthOptions {
    return { passwordLinks: this.links.available };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  // Every call may send an email: low limit per IP, plus one email per account per minute.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Email a link to choose a new password',
    description:
      'Always 202 with no body, whether the address has an account or not, so the answer does ' +
      'not reveal which addresses are registered. The link works once, for 30 minutes.',
  })
  @ApiAcceptedResponse({ description: 'If the account exists and is active, a link is on its way' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    await this.links.requestReset(dto.email, ctx);
  }

  @Public()
  @Post('password-link')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'What a password link opens',
    description:
      'The account and purpose of a link, before asking for the new password. POST, so the ' +
      'token stays out of URLs and logs.',
  })
  @ApiOkResponse({ description: '{ email, purpose: RESET | INVITE, expiresAt }' })
  @ApiBadRequestResponse({ description: 'PASSWORD_LINK_INVALID or PASSWORD_LINK_EXPIRED' })
  inspectLink(@Body() dto: PasswordLinkDto): Promise<PasswordLinkInfo> {
    return this.links.inspect(dto.token);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Choose a password with an emailed link',
    description:
      'Sets the password, ends every session of the account and invalidates its other links. ' +
      'Sign in afterwards.',
  })
  @ApiNoContentResponse({ description: 'Password set' })
  @ApiBadRequestResponse({
    description: 'PASSWORD_LINK_INVALID, PASSWORD_LINK_EXPIRED or a weak password',
  })
  resetPassword(@Body() dto: ResetPasswordDto, @ReqContext() ctx: RequestContext): Promise<void> {
    return this.links.complete(dto.token, dto.newPassword, ctx);
  }

  @Get('me')
  @AllowPendingPasswordChange()
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
