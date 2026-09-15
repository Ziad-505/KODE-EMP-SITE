import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  confirmTotpSchema,
  disableTotpSchema,
  loginSchema,
  totpChallengeSchema,
  type ChangePasswordInput,
  type ConfirmTotpInput,
  type DisableTotpInput,
  type LoginInput,
  type LoginResponse,
  type SessionUser,
  type SignInResult,
  type TotpChallengeInput,
  type TotpEnrolmentDto,
  type TotpStatusDto,
} from '@kode/contracts';
import type { Request, Response } from 'express';
import { ZodBody } from '../common/zod-validation.pipe';
import { RequestContextStore } from '../common/request-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthService } from './auth.service';
import { EntraService } from './entra.service';
import { TotpService } from './totp.service';
import { TokenService } from './token.service';
import { CurrentUser, Public } from './auth.decorators';
import { SkipCsrf } from './csrf.decorator';
import { AuthenticatedUser } from './authenticated-user';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './cookie.util';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly entra: EntraService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private context() {
    const ctx = RequestContextStore.get();
    return { ipAddress: ctx?.ipAddress ?? null, userAgent: ctx?.userAgent ?? null };
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Which sign-in methods this deployment offers' })
  providers(): { local: boolean; entra: boolean } {
    return { local: true, entra: this.entra.enabled };
  }

  @Public()
  @SkipCsrf()
  // No literal limit: the named `auth` throttler is configured from
  // AUTH_RATE_LIMIT_MAX in AppModule. Overriding it here meant changing that
  // environment variable had no effect on the two routes it exists for.
  @Throttle({ auth: {} })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with an email and password' })
  async login(
    @Body(ZodBody(loginSchema)) input: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResult> {
    const outcome = await this.auth.login(input, this.context());

    // Two shapes, and no cookies on the challenge path: until the second factor
    // is proved there is no session to put in one.
    if ('mfaRequired' in outcome) return outcome;

    setAuthCookies(response, this.env, outcome.tokens);
    return { user: outcome.user, expiresIn: outcome.tokens.expiresIn };
  }

  @Public()
  @SkipCsrf()
  @Throttle({ auth: {} })
  @Post('login/totp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish a sign-in that stopped at the second factor' })
  async loginTotp(
    @Body(ZodBody(totpChallengeSchema)) input: TotpChallengeInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse & { usedRecoveryCode: boolean }> {
    const { tokens, user, usedRecoveryCode } = await this.auth.completeTotpLogin(
      input.challengeToken,
      input.code,
      this.context(),
    );
    setAuthCookies(response, this.env, tokens);
    return { user, expiresIn: tokens.expiresIn, usedRecoveryCode };
  }

  /* --------------------------------------------- managing your own factor */

  @Get('2fa')
  @ApiOperation({ summary: 'Whether this account needs, and has, a second factor' })
  totpStatus(@CurrentUser() actor: AuthenticatedUser): Promise<TotpStatusDto> {
    return this.totp.statusFor(actor.id);
  }

  /**
   * Returns the secret and the recovery codes exactly once. Nothing stores the
   * codes in readable form, so a lost sheet means generating new ones rather
   * than looking the old ones up.
   */
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Begin enrolling an authenticator app' })
  beginTotp(@CurrentUser() actor: AuthenticatedUser): Promise<TotpEnrolmentDto> {
    return this.totp.beginEnrolment(actor.id, actor.email);
  }

  @Post('2fa/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Prove the authenticator works, switching the factor on' })
  async confirmTotp(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(ZodBody(confirmTotpSchema)) input: ConfirmTotpInput,
  ): Promise<void> {
    await this.totp.confirmEnrolment(actor.id, input.code);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Turn the second factor off, re-checking the password' })
  async disableTotp(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(ZodBody(disableTotpSchema)) input: DisableTotpInput,
  ): Promise<void> {
    await this.totp.disable(actor.id, input.password);
  }

  @Public()
  @SkipCsrf()
  @Throttle({ auth: {} })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token and mint a new access token' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ expiresIn: number; user: SessionUser }> {
    const raw = readCookie(request, REFRESH_COOKIE);
    if (!raw) throw new UnauthorizedException('No session');

    try {
      const tokens = await this.auth.refresh(raw, this.context());
      setAuthCookies(response, this.env, tokens);
      const user = await this.auth.getSessionUser(decodeSubject(tokens.accessToken));
      return { expiresIn: tokens.expiresIn, user };
    } catch (error) {
      clearAuthCookies(response, this.env);
      throw error;
    }
  }

  @Public()
  @SkipCsrf()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the current session' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser('id') userId: string | undefined,
  ): Promise<void> {
    await this.auth.logout(readCookie(request, REFRESH_COOKIE), userId ?? null);
    clearAuthCookies(response, this.env);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End every session for the current user' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ endedSessions: number }> {
    const endedSessions = await this.auth.logoutEverywhere(user.id);
    clearAuthCookies(response, this.env);
    return { endedSessions };
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, with their effective permissions' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<SessionUser> {
    return this.auth.getSessionUser(user.id);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Active sessions for the current user' })
  async sessions(@CurrentUser('id') userId: string) {
    return this.tokens.listSessions(userId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change the current password' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body(ZodBody(changePasswordSchema)) input: ChangePasswordInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword(userId, input.currentPassword, input.newPassword);
    clearAuthCookies(response, this.env);
  }

  /* ----------------------------- Entra ID ----------------------------- */

  @Public()
  @SkipCsrf()
  @Get('entra/start')
  @ApiOperation({ summary: 'Begin Microsoft Entra ID sign-in' })
  async entraStart(
    @Query('redirectTo') redirectTo: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const url = await this.entra.beginLogin(redirectTo);
    response.redirect(url);
  }

  @Public()
  @SkipCsrf()
  @Get('entra/callback')
  @ApiExcludeEndpoint()
  async entraCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (error) {
      const url = new URL('/sign-in', this.env.PORTAL_PUBLIC_URL);
      url.searchParams.set('error', errorDescription?.slice(0, 200) ?? error);
      response.redirect(url.toString());
      return;
    }
    if (!code || !state) throw new BadRequestException('Missing authorization code');

    const result = await this.entra.completeLogin(code, state, this.context());
    setAuthCookies(response, this.env, result.tokens);
    response.redirect(result.redirectTo);
  }
}

function readCookie(request: Request, name: string): string | undefined {
  return (request as Request & { cookies?: Record<string, string> }).cookies?.[name];
}

/** Reads `sub` from a token this process just signed. No verification needed. */
function decodeSubject(token: string): string {
  const segment = token.split('.')[1];
  if (!segment) throw new UnauthorizedException('Malformed token');
  const payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { sub: string };
  return payload.sub;
}
