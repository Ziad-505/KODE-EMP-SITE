import { SetMetadata } from '@nestjs/common';

export const SKIP_CSRF = 'auth:skip-csrf';

/**
 * Exempts a route from CSRF checking. Only correct for endpoints that are not
 * authenticated by an ambient cookie, such as the OIDC redirect callback.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);
