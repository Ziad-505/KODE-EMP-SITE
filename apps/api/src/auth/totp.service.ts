import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { generateTotpSecret, totpAuthUri, verifyTotp } from './totp';
import { randomBytes } from 'node:crypto';
import { Permission, Role, permissionsFor, type TotpEnrolmentDto } from '@kode/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

/** How many single-use recovery codes are issued at enrolment. */
const RECOVERY_CODE_COUNT = 10;

/**
 * Time-based one-time passwords.
 *
 * Scoped deliberately: the second factor is required for accounts that can
 * reach the CMS, and not for ordinary employees. The portal is read-mostly and
 * behind the same session; the CMS can publish content, change someone's role
 * and read the audit trail. Requiring a phone from three hundred staff to
 * protect the reading of a canteen menu is the kind of security theatre that
 * gets switched off six weeks later.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Whether this role must carry a second factor at all. */
  requiresTotp(role: Role, extraPermissions: readonly Permission[] = []): boolean {
    // `departmentId` is irrelevant to which permissions a role grants, but it
    // is part of the shared ActorLike shape, so it is passed explicitly rather
    // than the type being widened for one caller.
    return permissionsFor({ role, departmentId: null, extraPermissions }).includes(
      Permission.CMS_ACCESS,
    );
  }

  /**
   * True when `token` is a live code for `secret`.
   *
   * The drift window and the constant-time comparison both live in `./totp`,
   * which is verified against the RFC 6238 vectors.
   */
  private isValidCode(secret: string, token: string): boolean {
    return verifyTotp(secret, token);
  }

  /**
   * Starts enrolment. The secret is stored immediately but stays unconfirmed,
   * so an abandoned attempt never locks anyone out and the next attempt simply
   * replaces it. Recovery codes are generated here and returned once — only
   * their hashes are kept.
   */
  async beginEnrolment(userId: string, email: string): Promise<TotpEnrolmentDto> {
    const secret = generateTotpSecret();
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
    const hashed = await Promise.all(
      recoveryCodes.map((code) => this.passwords.hash(normalise(code))),
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpConfirmedAt: null, totpRecoveryCodes: hashed },
    });

    // The label is what the authenticator app shows in its list. Issuer first
    // so a phone with several work accounts groups them sensibly.
    const uri = totpAuthUri(email, this.totpIssuer(), secret);

    return {
      secret,
      uri,
      /*
       * Rendered here, not by a QR service on the internet. The URI encodes the
       * shared secret, so sending it anywhere else would hand that party the
       * ability to generate valid codes for this account — and the CSP would
       * block the resulting remote image anyway.
       */
      qrDataUri: await qrToDataUrl(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 }),
      recoveryCodes,
    };
  }

  /**
   * Confirms enrolment with a code the person has just read off their phone.
   *
   * This is the step that makes the factor real: until it passes, the account
   * signs in with a password alone. Proving the app works *before* requiring it
   * is what stops enrolment from being a way to lock yourself out.
   */
  async confirmEnrolment(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecret: true, totpConfirmedAt: true },
    });

    if (!user.totpSecret) {
      throw new BadRequestException('Start setting up two-factor authentication first.');
    }
    if (user.totpConfirmedAt) {
      throw new BadRequestException('Two-factor authentication is already switched on.');
    }
    if (!this.isValidCode(user.totpSecret, code)) {
      throw new BadRequestException('That code is not right. Check your app and try again.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpConfirmedAt: new Date() },
    });
  }

  /**
   * Verifies a code during sign-in, accepting either a live TOTP or one of the
   * recovery codes.
   *
   * Recovery codes are single-use: a matching one is removed from the array in
   * the same write that accepts it, so replaying it fails. Returns which kind
   * was used, because a recovery code is worth telling the user about.
   */
  async verifyForSignIn(userId: string, code: string): Promise<'totp' | 'recovery'> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecret: true, totpConfirmedAt: true, totpRecoveryCodes: true },
    });

    if (!user.totpSecret || !user.totpConfirmedAt) {
      throw new BadRequestException('Two-factor authentication is not set up on this account.');
    }

    const candidate = normalise(code);

    if (/^\d{6}$/.test(candidate) && this.isValidCode(user.totpSecret, candidate)) {
      return 'totp';
    }

    for (const hash of user.totpRecoveryCodes) {
      if (await this.passwords.verify(hash, candidate)) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { totpRecoveryCodes: user.totpRecoveryCodes.filter((h) => h !== hash) },
        });
        this.logger.warn(`Recovery code used for user ${userId}`);
        return 'recovery';
      }
    }

    /*
     * Deliberately one message for a wrong TOTP and a wrong recovery code.
     * Telling them apart would confirm to an attacker which of the two they are
     * closer to guessing.
     */
    throw new BadRequestException('That code is not right.');
  }

  /** What the account needs and what it has, for the settings screen. */
  async statusFor(userId: string): Promise<{
    required: boolean;
    enrolled: boolean;
    recoveryCodesRemaining: number;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        role: true,
        extraPermissions: true,
        totpConfirmedAt: true,
        totpRecoveryCodes: true,
      },
    });

    return {
      required: this.requiresTotp(user.role as Role, user.extraPermissions as Permission[]),
      enrolled: user.totpConfirmedAt !== null,
      recoveryCodesRemaining: user.totpRecoveryCodes.length,
    };
  }

  /** Turns the factor off, after re-checking the password. */
  async disable(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user.passwordHash || !(await this.passwords.verify(user.passwordHash, password))) {
      throw new BadRequestException('That password is not right.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpConfirmedAt: null, totpRecoveryCodes: [] },
    });
  }

  /** The name the authenticator app shows beside the code. */
  private totpIssuer(): string {
    try {
      return new URL(this.env.PORTAL_PUBLIC_URL).hostname;
    } catch {
      return 'KODE Portal';
    }
  }
}

/**
 * Twenty characters of base32-ish alphabet, grouped for transcription.
 *
 * `randomBytes` rather than `Math.random`: these are credentials. The alphabet
 * omits nothing clever — it is the full lowercase alphanumeric set, and the
 * grouping exists purely so someone can read one off a printed sheet without
 * losing their place.
 */
function generateRecoveryCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return (chars.join('').match(/.{1,4}/g) ?? []).join('-');
}

/** Strips the grouping dashes and casing so paper and screen agree. */
function normalise(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
