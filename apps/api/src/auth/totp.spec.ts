import {
  TOTP_PERIOD_SECONDS,
  generateTotp,
  generateTotpSecret,
  totpAuthUri,
  verifyTotp,
} from './totp';

/**
 * RFC 4226 and RFC 6238 published test vectors.
 *
 * This is the justification for implementing TOTP in this repository rather
 * than depending on a package: an implementation either reproduces these exact
 * numbers or it is wrong, and there is no room for it to be subtly wrong in a
 * way that only shows up in production. The two realistic mistakes — the wrong
 * byte order on the counter, and dropping the high-bit mask in the dynamic
 * truncation — both fail here immediately.
 */
describe('TOTP', () => {
  // RFC 6238 Appendix B uses the ASCII string "12345678901234567890" as the
  // seed. Base32 of those 20 bytes:
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  describe('RFC 6238 Appendix B vectors (SHA-1)', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];

    it.each(vectors)('at unix time %i produces %s', (atSeconds, expected) => {
      expect(generateTotp(RFC_SECRET, atSeconds)).toBe(expected);
    });
  });

  describe('RFC 4226 Appendix D counter sequence', () => {
    // The same seed stepped one counter at a time. Because TOTP's counter is
    // floor(time / 30), walking time in 30-second steps walks the HOTP counter
    // in ones — so these are the HOTP vectors reached through the TOTP door,
    // which also proves the step arithmetic.
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];

    it.each(expected.map((code, counter) => [counter, code]))(
      'counter %i produces %s',
      (counter, code) => {
        expect(generateTotp(RFC_SECRET, (counter as number) * TOTP_PERIOD_SECONDS)).toBe(code);
      },
    );
  });

  describe('verification', () => {
    const now = 1_700_000_000;

    it('accepts the current code', () => {
      expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now), now)).toBe(true);
    });

    it('accepts one step of clock drift in both directions', () => {
      const past = generateTotp(RFC_SECRET, now - TOTP_PERIOD_SECONDS);
      const future = generateTotp(RFC_SECRET, now + TOTP_PERIOD_SECONDS);
      expect(verifyTotp(RFC_SECRET, past, now)).toBe(true);
      expect(verifyTotp(RFC_SECRET, future, now)).toBe(true);
    });

    it('refuses a code two steps old, so a glimpsed code expires', () => {
      const stale = generateTotp(RFC_SECRET, now - 2 * TOTP_PERIOD_SECONDS);
      expect(verifyTotp(RFC_SECRET, stale, now)).toBe(false);
    });

    it('refuses anything that is not six digits', () => {
      for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56', '<script>']) {
        expect(verifyTotp(RFC_SECRET, bad, now)).toBe(false);
      }
    });

    it('refuses a valid-looking code for a different secret', () => {
      const other = generateTotpSecret();
      const code = generateTotp(other, now);
      // Guard against the vanishingly unlikely collision rather than asserting
      // blindly, so this test can never flake.
      if (code !== generateTotp(RFC_SECRET, now)) {
        expect(verifyTotp(RFC_SECRET, code, now)).toBe(false);
      }
    });
  });

  describe('secret generation', () => {
    it('produces 32 base32 characters, which is 160 bits', () => {
      const secret = generateTotpSecret();
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    });

    it('does not repeat', () => {
      const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
      expect(secrets.size).toBe(50);
    });

    it('round-trips through generate and verify', () => {
      const secret = generateTotpSecret();
      const now = 1_700_000_000;
      expect(verifyTotp(secret, generateTotp(secret, now), now)).toBe(true);
    });
  });

  describe('otpauth URI', () => {
    it('encodes the account and issuer, and repeats the issuer as a parameter', () => {
      const uri = totpAuthUri('ziad@kodesportsclub.com', 'cms.kode.internal', RFC_SECRET);
      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('cms.kode.internal%3Aziad%40kodesportsclub.com'.replace('%3A', ':'));
      expect(uri).toContain(`secret=${RFC_SECRET}`);
      expect(uri).toContain('issuer=cms.kode.internal');
      expect(uri).toContain('period=30');
    });

    it('percent-encodes an address that would otherwise break the label', () => {
      const uri = totpAuthUri('a b@c.com', 'KODE Portal', RFC_SECRET);
      expect(uri).not.toMatch(/totp\/[^?]*\s/);
    });
  });
});
