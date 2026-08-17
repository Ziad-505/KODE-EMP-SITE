# Contributing

## Before you push

```bash
make check     # typecheck, lint, unit tests
```

CI runs the same thing plus migrations, integration tests, image builds and a
dependency audit.

## Conventions

**Formatting is not a matter of taste.** Prettier decides. Run `pnpm format`.
Source is never minified by hand; the bundler does that.

**Validation lives in `@kode/contracts`.** If a rule belongs to the domain, it
goes in a Zod schema there, not in a controller and again in a form.

**Authorization is declarative.** New endpoints get `@RequirePermissions(...)`.
If you find yourself writing an `if (user.role === ...)` in a controller, the
rule belongs in `rbac.ts` or `ContentPolicy` instead.

**Every mutation writes an audit entry.** If it changes data a human cares
about, it is recorded, with a diff where one makes sense.

**Errors carry a request id.** Never swallow one. The filter in
`common/http-exception.filter.ts` is the only place an error becomes a response.

## Adding a content type

1. Add the model to `apps/api/prisma/schema.prisma`; run `db:migrate`.
2. Add the permissions to `packages/contracts/src/rbac.ts` and put them in the
   right role bundles.
3. Add the Zod schemas and DTO to `packages/contracts/src/content.ts`.
4. Add a service following `articles.service.ts` — it is the reference
   implementation, and the department-scope and status-transition calls are not
   optional.
5. Add a controller with the permission annotations.
6. Add an entry to `apps/admin/src/lib/resources.ts`. The CMS list and editor
   pick it up with no further changes.

## Tests

Unit tests cover the pure logic that carries the most risk: the permission
model, the content policy, file signature detection and environment validation.
The e2e suite covers authentication, authorization, CSRF, token rotation and the
audit trail against a real database.

`test/bootstrap.e2e-spec.ts` boots the real application with the database
stubbed. It is the cheapest test in the suite and it catches the errors a unit
test structurally cannot: a provider that does not resolve, a global guard wired
into the wrong injector, a route that turns out to be reachable without a token.
It found exactly that during the first build, when `JwtAuthGuard` was registered
with `APP_GUARD` in `AppModule` while `JwtService` was only provided inside
`AuthModule` — the application would not have started. Run it before you push.

If you change anything in `rbac.ts` or `content.policy.ts`, add a test. Those two
files are where an error becomes a security bug rather than a rendering glitch.
