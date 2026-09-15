/**
 * Environment for the end-to-end suites, applied before anything is imported.
 *
 * `app.module.ts` calls `loadEnv()` at module scope and hands the result to
 * `ThrottlerModule.forRoot`, so the rate limits are fixed the moment the module
 * graph is imported. Setting these inside `beforeAll` is too late — ES imports
 * hoist above it — which is why this runs from `setupFiles` instead.
 *
 * The sign-in bucket defaults to ten per minute. That is a good production
 * default and is deliberately left alone there; but a suite that exercises five
 * roles across authorization, refresh-token rotation, CSRF and the audit trail
 * signs in far more than ten times in well under a minute, so it spent its own
 * allowance and then failed the rest of its assertions with 429 instead of
 * testing what it was written to test.
 *
 * `??=` so an explicit value from CI or a developer's shell still wins.
 */
process.env.AUTH_RATE_LIMIT_MAX ??= '1000';
process.env.RATE_LIMIT_MAX ??= '10000';
