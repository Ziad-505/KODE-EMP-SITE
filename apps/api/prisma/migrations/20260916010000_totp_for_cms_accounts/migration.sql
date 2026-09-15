-- Time-based one-time passwords for accounts that can reach the CMS.
--
-- All three columns are nullable or defaulted, so this applies to a populated
-- database without touching a single existing row. Nobody is locked out by the
-- migration: enforcement begins only once an account has a confirmed secret,
-- and the enrolment flow is what sets that.
ALTER TABLE "users" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "users" ADD COLUMN "totpConfirmedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "totpRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
