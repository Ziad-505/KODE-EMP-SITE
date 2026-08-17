import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditAction,
  Permission,
  Role,
  UserStatus,
  permissionsFor,
  type LoginInput,
  type SessionUser,
} from '@kode/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaUrlService } from '../media/media-url.service';
import { PasswordService } from './password.service';
import { TokenService, type IssuedTokens } from './token.service';

export interface AuthContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mediaUrls: MediaUrlService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(
    input: LoginInput,
    context: AuthContext,
  ): Promise<{ tokens: IssuedTokens; user: SessionUser }> {
    const user = await this.prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
      include: { department: true, avatarMedia: true },
    });

    // Constant-time behaviour for unknown accounts: same work, same message.
    if (!user || !user.passwordHash) {
      await this.passwords.burnVerify(input.password);
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        entityId: user?.id ?? null,
        summary: `Failed sign-in for ${input.email}`,
        actorId: null,
      });
      throw new UnauthorizedException('Email or password is incorrect');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }

    const valid = await this.passwords.verify(user.passwordHash, input.password);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginCount, input.email);
      throw new UnauthorizedException('Email or password is incorrect');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('This account has been suspended.');
    }

    // Transparently upgrade the hash if the cost parameters have moved on.
    const patch: Record<string, unknown> = {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(user.status === UserStatus.INVITED ? { status: UserStatus.ACTIVE } : {}),
    };
    if (this.passwords.needsRehash(user.passwordHash)) {
      patch.passwordHash = await this.passwords.hash(input.password);
    }
    await this.prisma.user.update({ where: { id: user.id }, data: patch });

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
      summary: `${user.firstName} ${user.lastName} signed in with a password`,
      actorId: user.id,
    });

    return { tokens, user: this.toSessionUser(user) };
  }

  async refresh(rawToken: string, context: AuthContext): Promise<IssuedTokens> {
    return this.tokens.rotate(rawToken, context);
  }

  async logout(rawToken: string | undefined, actorId: string | null): Promise<void> {
    if (rawToken) await this.tokens.revokeToken(rawToken, 'User signed out');
    if (actorId) {
      await this.audit.record({
        action: AuditAction.LOGOUT,
        entityType: 'User',
        entityId: actorId,
        summary: 'Signed out',
        actorId,
      });
    }
  }

  async logoutEverywhere(userId: string): Promise<number> {
    const count = await this.tokens.revokeAllForUser(userId, 'Signed out of all devices');
    await this.audit.record({
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: userId,
      summary: `Signed out of all devices (${count} session${count === 1 ? '' : 's'})`,
      actorId: userId,
    });
    return count;
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      throw new ForbiddenException('This account signs in with Microsoft and has no password.');
    }

    const valid = await this.passwords.verify(user.passwordHash, current);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.passwords.hash(next),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    // Changing a password ends every other session, which is what users expect
    // when the reason they changed it is that they think it was compromised.
    await this.tokens.revokeAllForUser(userId, 'Password changed');

    await this.audit.record({
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: userId,
      summary: 'Changed their password; all other sessions were ended',
      actorId: userId,
    });
  }

  async getSessionUser(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { department: true, avatarMedia: true },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('This account has been suspended.');
    }
    return this.toSessionUser(user);
  }

  toSessionUser(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    role: string;
    status: string;
    provider: string;
    departmentId: string | null;
    department: { name: string } | null;
    avatarMedia: { storageKey: string } | null;
    extraPermissions: string[];
    mustChangePassword: boolean;
  }): SessionUser {
    const role = user.role as Role;
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: `${user.firstName} ${user.lastName}`.trim(),
      jobTitle: user.jobTitle,
      role,
      status: user.status as UserStatus,
      provider: user.provider as SessionUser['provider'],
      departmentId: user.departmentId,
      departmentName: user.department?.name ?? null,
      avatarUrl: user.avatarMedia ? this.mediaUrls.toUrl(user.avatarMedia.storageKey) : null,
      permissions: [
        ...permissionsFor({
          role,
          departmentId: user.departmentId,
          extraPermissions: user.extraPermissions as Permission[],
        }),
      ],
      mustChangePassword: user.mustChangePassword,
    };
  }

  private async registerFailedAttempt(
    userId: string,
    currentCount: number,
    email: string,
  ): Promise<void> {
    const attempts = currentCount + 1;
    const shouldLock = attempts >= this.env.LOGIN_MAX_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + this.env.LOGIN_LOCKOUT_MINUTES * 60_000)
          : null,
      },
    });

    await this.audit.record({
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      entityId: userId,
      summary: shouldLock
        ? `Account locked after ${attempts} failed sign-in attempts (${email})`
        : `Failed sign-in attempt ${attempts} for ${email}`,
      actorId: null,
    });

    if (shouldLock) this.logger.warn(`Locked account ${email} after ${attempts} failures`);
  }
}
