import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) on top of HOTP (RFC 4226).
 *
 * Written here rather than pulled from a package, which deserves an
 * explanation: the obvious candidate, otplib v13, is ESM-only and depends on
 * `@scure/base`, which this project's CommonJS Jest pipeline cannot parse. The
 * choice was between reshaping the test toolchain around one dependency or
 * writing the forty lines the RFC specifies.
 *
 * This is not "rolling your own crypto" in the sense that phrase usually warns
 * about. No primitive is invented: the HMAC is Node's, the truncation is
 * transcribed from RFC 4226 section 5.3, and the whole thing is verified
 * against the published test vectors in `totp.spec.ts`. The only real risk in
 * an implementation like this is getting the byte order or the truncation mask
 * wrong, which is exactly what those vectors catch.
 */

/** Seconds per step. 30 is the value every authenticator app assumes. */
export const TOTP_PERIOD_SECONDS = 30;

/** Digits in a generated code. */
const TOTP_DIGITS = 6;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * A new shared secret, base32-encoded.
 *
 * 20 bytes / 160 bits, which is what RFC 4226 recommends and what every
 * authenticator app expects from a `otpauth://` URI.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * The code for a given secret at a given moment.
 *
 * `atSeconds` is injectable so the tests can stand at the exact instants the
 * RFC's vectors describe rather than hoping the clock cooperates.
 */
export function generateTotp(
  secret: string,
  atSeconds: number = Math.floor(Date.now() / 1000),
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1',
): string {
  const counter = Math.floor(atSeconds / TOTP_PERIOD_SECONDS);
  return hotp(base32Decode(secret), counter, algorithm);
}

/**
 * Whether `token` is valid for `secret` right now.
 *
 * `stepTolerance` steps either side of the present are accepted, which is the
 * slack a phone with a slightly wrong clock needs — the most common cause of
 * "the code does not work". One step is 30 seconds; more than that and a code
 * glimpsed over a shoulder stays live long enough to be worth stealing.
 */
export function verifyTotp(
  secret: string,
  token: string,
  atSeconds: number = Math.floor(Date.now() / 1000),
  stepTolerance = 1,
): boolean {
  const candidate = token.trim();
  if (!/^\d{6}$/.test(candidate)) return false;

  for (let drift = -stepTolerance; drift <= stepTolerance; drift += 1) {
    const expected = generateTotp(secret, atSeconds + drift * TOTP_PERIOD_SECONDS);
    // Constant-time: a length-safe compare that does not leak how many leading
    // digits were right through timing.
    if (constantTimeEquals(expected, candidate)) return true;
  }
  return false;
}

/**
 * The `otpauth://` URI an authenticator app reads from a QR code.
 *
 * Both label and issuer are percent-encoded, and the issuer is repeated as a
 * query parameter — apps disagree about which one they read, and a mismatch
 * shows up as two entries for the same account.
 */
export function totpAuthUri(accountName: string, issuer: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ------------------------------------------------------------------ HOTP */

/** RFC 4226. The counter is a big-endian unsigned 64-bit integer. */
function hotp(key: Buffer, counter: number, algorithm: 'sha1' | 'sha256' | 'sha512'): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(algorithm, key).update(counterBytes).digest();

  // Dynamic truncation, RFC 4226 section 5.3: the low nibble of the last byte
  // selects a four-byte window, whose top bit is masked off so the result is
  // always a positive 31-bit integer.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/* ---------------------------------------------------------------- base32 */

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  // No `=` padding: authenticator apps accept it either way, and its absence
  // makes the secret easier to read aloud during a support call.
  return output;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal; both values here are fixed-width codes, so a difference in
  // length simply means "not equal".
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
