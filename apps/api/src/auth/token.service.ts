import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Permission, Role } from '@kode/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, RefreshTokenPayload } from './jwt-payload';

/**
 * How long a spent refresh token stays on file past its own expiry, so replay
 * detection still has something to match against. Seven days covers the gap
 * between a theft and a lazy attacker.
 */
const REPLAY_EVIDENCE_GRACE_DAYS = 7;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  sessionId: string;
  expiresIn: number;
}

interface TokenSubject {
  id: string;
  email: string;
  role: Role;
  departmentId: string | null;
  extraPermissions: Permission[];
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Starts a new session: a fresh refresh-token family. */
  async issueSession(
    user: TokenSubject,
    context: { ipAddress: string | null; userAgent: string | null },
  ): Promise<IssuedTokens> {
    return this.issue(user, randomUUID(), context);
  }

  /**
   * Rotates a refresh token.
   *
   * Every refresh mints a new token and marks the old one rotated. Presenting
   * an already-rotated token means the token was replayed, which in practice
   * means it was stolen. The entire family is revoked, so both the attacker and
   * the legitimate user are logged out and the theft becomes visible instead of
   * silently persisting.
   */
  async rotate(
    rawToken: string,
    context: { ipAddress: string | null; userAgent: string | null },
  ): Promise<IssuedTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Wrong token type');

    const tokenHash = hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            departmentId: true,
            extraPermissions: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!stored) throw new UnauthorizedException('Session expired');

    if (stored.rotatedAt || stored.revokedAt) {
      await this.revokeFamily(stored.familyId, 'Refresh token replay detected');
      this.logger.warn(
        `Refresh token replay for user ${stored.userId}; revoked family ${stored.familyId}`,
      );
      throw new UnauthorizedException('Session revoked. Please sign in again.');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired');
    }

    const user = stored.user;
    if (user.deletedAt || user.status === 'SUSPENDED') {
      await this.revokeFamily(stored.familyId, 'Account no longer active');
      throw new UnauthorizedException('Account is not active');
    }

    /*
     * The claim is conditional, not a plain update. Detection was previously a
     * read at the top of this method followed by an unguarded write here, so a
     * stolen token replayed at the same moment the real client refreshed had
     * both requests read `rotatedAt: null`, both pass the replay check, and
     * both mint a session in the same family. The theft went unnoticed.
     *
     * `updateMany` with `rotatedAt: null` in the predicate makes exactly one
     * request win. The loser is, by definition, a replay.
     */
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(stored.familyId, 'Refresh token replay detected');
      this.logger.warn(
        `Concurrent refresh for user ${stored.userId}; revoked family ${stored.familyId}`,
      );
      throw new UnauthorizedException('Session revoked. Please sign in again.');
    }

    return this.issue(
      {
        id: user.id,
        email: user.email,
        role: user.role as Role,
        departmentId: user.departmentId,
        extraPermissions: user.extraPermissions as Permission[],
      },
      stored.familyId,
      context,
    );
  }

  async revokeToken(rawToken: string, reason: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Used when a role changes or an account is suspended: kill every session. */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  async listSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, familyId: true, ipAddress: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Housekeeping: drop tokens that can no longer be used *and* can no longer
   * tell us anything.
   *
   * Replay detection works by finding a row that is already rotated or revoked
   * and revoking its whole family. Deleting revoked rows after 24 hours deleted
   * exactly that evidence: a token stolen on Monday and replayed on Wednesday
   * matched nothing, so it read as an ordinary unknown token and raised no
   * alarm. The window has to outlive the token, not undercut it.
   *
   * Retention is therefore the refresh token's own lifetime plus a margin, so a
   * spent token stays recognisable for as long as the attacker could plausibly
   * still be holding it. Rows are small and there are a few per person per
   * fortnight; this costs nothing to keep.
   */
  async purgeExpired(): Promise<number> {
    const retentionDays = this.env.REFRESH_TOKEN_TTL_DAYS + REPLAY_EVIDENCE_GRACE_DAYS;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.refreshToken.deleteMany({
      // Both dates, so a row survives until the later of the two has passed.
      where: {
        expiresAt: { lt: cutoff },
        OR: [{ revokedAt: null }, { revokedAt: { lt: cutoff } }],
      },
    });
    return result.count;
  }

  private async issue(
    user: TokenSubject,
    familyId: string,
    context: { ipAddress: string | null; userAgent: string | null },
  ): Promise<IssuedTokens> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      dept: user.departmentId,
      perm: user.extraPermissions,
      sid: familyId,
      typ: 'access',
    };

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sid: familyId,
      jti,
      typ: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.env.JWT_ACCESS_SECRET,
        expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.env.JWT_REFRESH_SECRET,
        expiresIn: `${this.env.REFRESH_TOKEN_TTL_DAYS}d`,
      }),
    ]);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        familyId,
        userId: user.id,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      csrfToken: randomBytes(32).toString('base64url'),
      sessionId: familyId,
      expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}

/** Only the hash is persisted, so a database leak cannot resume a session. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
