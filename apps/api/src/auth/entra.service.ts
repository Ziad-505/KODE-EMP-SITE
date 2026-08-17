import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AuditAction, Permission, Role, UserStatus, type SessionUser } from '@kode/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService, type AuthContext } from './auth.service';
import { TokenService, type IssuedTokens } from './token.service';

interface EntraIdTokenClaims extends JWTPayload {
  oid?: string;
  tid?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  jobTitle?: string;
  nonce?: string;
}

/**
 * Microsoft Entra ID sign-in, implemented directly against the OIDC endpoints.
 *
 * Authorization code flow with PKCE (S256) and a nonce. State and code verifier
 * are stored server-side rather than in a cookie, so a cross-site attacker
 * cannot fixate them, and each one is single-use with a short expiry.
 *
 * The whole module is inert when ENTRA_ENABLED is false, which is what lets the
 * stack run and be tested with no Azure tenant.
 */
@Injectable()
export class EntraService {
  private readonly logger = new Logger(EntraService.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  private static readonly STATE_TTL_MS = 10 * 60 * 1000;
  private static readonly SCOPES = 'openid profile email offline_access User.Read';

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get enabled(): boolean {
    return this.env.ENTRA_ENABLED;
  }

  /**
   * The `.../v2.0` form is the token *issuer*, not the base for endpoints, and
   * using it for both meant every SSO attempt 404'd: authorize and token live
   * under `/oauth2/v2.0/`, and JWKS under `/discovery/v2.0/keys`. The two are
   * now separate because they are genuinely different values.
   */
  private get tenantBase(): string {
    return `https://login.microsoftonline.com/${this.env.ENTRA_TENANT_ID}`;
  }

  /** Expected `iss` on the id token. */
  private get issuer(): string {
    return `${this.tenantBase}/v2.0`;
  }

  private get authorizeEndpoint(): string {
    return `${this.tenantBase}/oauth2/v2.0/authorize`;
  }

  private get tokenEndpoint(): string {
    return `${this.tenantBase}/oauth2/v2.0/token`;
  }

  private get jwksUri(): string {
    return `${this.tenantBase}/discovery/v2.0/keys`;
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Microsoft sign-in is not configured on this server.');
    }
  }

  /** Step 1: build the Microsoft authorization URL and remember the challenge. */
  async beginLogin(redirectTo?: string): Promise<string> {
    this.assertEnabled();

    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    await this.prisma.oidcState.create({
      data: {
        state,
        codeVerifier,
        nonce,
        redirectTo: sanitiseRedirect(redirectTo, [
          this.env.PORTAL_PUBLIC_URL,
          this.env.ADMIN_PUBLIC_URL,
        ]),
        expiresAt: new Date(Date.now() + EntraService.STATE_TTL_MS),
      },
    });

    const params = new URLSearchParams({
      client_id: this.env.ENTRA_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: this.env.ENTRA_REDIRECT_URI!,
      response_mode: 'query',
      scope: EntraService.SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${this.authorizeEndpoint}?${params.toString()}`;
  }

  /** Step 2: exchange the code, verify the id token, provision or link the user. */
  async completeLogin(
    code: string,
    state: string,
    context: AuthContext,
  ): Promise<{ tokens: IssuedTokens; user: SessionUser; redirectTo: string }> {
    this.assertEnabled();

    const stored = await this.prisma.oidcState.findUnique({ where: { state } });
    // Single-use: delete before doing anything else, so a replay finds nothing.
    if (stored) await this.prisma.oidcState.delete({ where: { id: stored.id } }).catch(() => {});

    if (!stored || stored.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Sign-in request expired. Please try again.');
    }

    const claims = await this.exchangeAndVerify(code, stored.codeVerifier, stored.nonce);
    const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase().trim();

    if (!email || !claims.oid) {
      throw new BadRequestException('Microsoft did not return an email address for this account.');
    }
    this.assertDomainAllowed(email);
    if (this.env.ENTRA_TENANT_ID && claims.tid && claims.tid !== this.env.ENTRA_TENANT_ID) {
      throw new ForbiddenException('This Microsoft account is outside the club tenant.');
    }

    const user = await this.findOrProvision(claims, email);
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('This account has been suspended.');
    }

    const tokens = await this.tokens.issueSession(
      {
        id: user.id,
        email: user.email,
        role: user.role as Role,
        departmentId: user.departmentId,
        extraPermissions: user.extraPermissions as Permission[],
      },
      context,
    );

    await this.audit.record({
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      summary: `${user.firstName} ${user.lastName} signed in with Microsoft`,
      actorId: user.id,
    });

    const full = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { department: true, avatarMedia: true },
    });

    return {
      tokens,
      user: this.auth.toSessionUser(full),
      redirectTo: stored.redirectTo ?? this.env.PORTAL_PUBLIC_URL,
    };
  }

  /** Housekeeping for the scheduled task. */
  async purgeExpiredStates(): Promise<number> {
    const result = await this.prisma.oidcState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }

  private async exchangeAndVerify(
    code: string,
    codeVerifier: string,
    expectedNonce: string,
  ): Promise<EntraIdTokenClaims> {
    const body = new URLSearchParams({
      client_id: this.env.ENTRA_CLIENT_ID!,
      client_secret: this.env.ENTRA_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.env.ENTRA_REDIRECT_URI!,
      code_verifier: codeVerifier,
      scope: EntraService.SCOPES,
    });

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Entra token exchange failed (${response.status}): ${detail.slice(0, 500)}`,
      );
      throw new BadRequestException('Microsoft rejected the sign-in. Please try again.');
    }

    const payload = (await response.json()) as { id_token?: string };
    if (!payload.id_token) throw new BadRequestException('Microsoft did not return an id token.');

    this.jwks ??= createRemoteJWKSet(new URL(this.jwksUri));

    const { payload: claims } = await jwtVerify<EntraIdTokenClaims>(payload.id_token, this.jwks, {
      issuer: this.issuer,
      audience: this.env.ENTRA_CLIENT_ID!,
      clockTolerance: 60,
    });

    if (claims.nonce !== expectedNonce) {
      throw new BadRequestException('Sign-in verification failed.');
    }
    return claims;
  }

  private assertDomainAllowed(email: string): void {
    const allowed = this.env.ENTRA_ALLOWED_DOMAINS;
    if (allowed.length === 0) return;
    const domain = email.split('@')[1] ?? '';
    if (!allowed.some((entry) => entry.toLowerCase() === domain)) {
      throw new ForbiddenException('This email domain is not permitted to sign in.');
    }
  }

  private async findOrProvision(claims: EntraIdTokenClaims, email: string) {
    const byObjectId = await this.prisma.user.findFirst({
      where: { entraObjectId: claims.oid, deletedAt: null },
    });
    if (byObjectId) {
      return this.prisma.user.update({
        where: { id: byObjectId.id },
        data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });
    }

    const byEmail = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (byEmail) {
      // Link the existing local account to the Entra identity. The role that was
      // already assigned wins; SSO never silently changes someone's privileges.
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          entraObjectId: claims.oid,
          entraTenantId: claims.tid ?? null,
          provider: 'ENTRA_ID',
          status: byEmail.status === UserStatus.INVITED ? UserStatus.ACTIVE : byEmail.status,
          lastLoginAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
    }

    if (!this.env.ENTRA_AUTO_PROVISION) {
      throw new ForbiddenException(
        'No portal account exists for this Microsoft user. Ask a Super Admin to create one.',
      );
    }

    const [firstName, lastName] = splitName(claims);
    return this.prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        jobTitle: claims.jobTitle ?? null,
        role: this.env.ENTRA_DEFAULT_ROLE as Role,
        status: UserStatus.ACTIVE,
        provider: 'ENTRA_ID',
        entraObjectId: claims.oid!,
        entraTenantId: claims.tid ?? null,
        lastLoginAt: new Date(),
      },
    });
  }
}

function splitName(claims: EntraIdTokenClaims): [string, string] {
  if (claims.given_name || claims.family_name) {
    return [claims.given_name ?? '', claims.family_name ?? ''];
  }
  const parts = (claims.name ?? '').trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return ['KODE', 'Employee'];
  return [parts[0]!, parts.slice(1).join(' ') || ''];
}

/** Open-redirect protection: only allow returning to a known front-end origin. */
function sanitiseRedirect(target: string | undefined, allowedOrigins: string[]): string | null {
  if (!target) return null;
  try {
    const url = new URL(target);
    const isAllowed = allowedOrigins.some((origin) => new URL(origin).origin === url.origin);
    return isAllowed ? url.toString() : null;
  } catch {
    return null;
  }
}
