import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id with OWASP's recommended parameters (19 MiB, t=2, p=1).
 * Chosen over bcrypt because bcrypt silently truncates at 72 bytes and has no
 * memory-hardness.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Hash of a random string, used to keep failed logins constant-time. */
let dummyHash: string | null = null;

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Burns the same work as a real verification when the account does not exist.
   * Without this, response timing tells an attacker which emails are registered.
   */
  async burnVerify(plain: string): Promise<void> {
    dummyHash ??= await this.hash(randomBytes(24).toString('hex'));
    await this.verify(dummyHash, plain);
  }

  /** Whether an existing hash was produced with weaker parameters. */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }

  generateTemporaryPassword(): string {
    // 24 bytes base64url: ~144 bits of entropy, no ambiguous characters.
    return randomBytes(18).toString('base64url');
  }

  static constantTimeEquals(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
