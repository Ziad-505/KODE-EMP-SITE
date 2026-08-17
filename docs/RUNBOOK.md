# Runbook

Operational procedures. Written to be followed at 2am by someone who did not
build this.

## Deploy

```bash
git pull
docker compose up -d --build
docker compose exec api ./node_modules/.bin/prisma migrate deploy
docker compose ps          # every service should be healthy
curl -fsS https://<PORTAL_DOMAIN>/api/v1/health/ready | jq
```

Migrations are **not** applied automatically on start in production. That is
deliberate: an automatic migration on a crash-looping container can apply a
half-broken schema repeatedly. Apply it yourself and watch it.

### Rollback

```bash
git checkout <previous-tag>
docker compose up -d --build
```

Application rollback is safe. **Schema rollback is not automatic.** If the bad
release included a destructive migration, restore from backup instead. Write
migrations to be backwards compatible with the previous release (add a column,
deploy, backfill, then remove the old one in a later release) so this situation
does not arise.

## Health

| Endpoint               | Meaning                                                    | Used by                            |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------- |
| `/api/v1/health/live`  | The process is running                                     | Docker healthcheck, restart policy |
| `/api/v1/health/ready` | It can serve traffic: database reachable, outbox not stuck | Load balancer, alerting            |

`ready` returns 503 when the database is unreachable or the outbox has
dead-lettered messages.

## Backups

The `backup` service takes a compressed `pg_dump` daily at 02:15 UTC into
`./backups`, keeping `BACKUP_RETENTION_DAYS` (default 14).

```bash
docker compose logs backup | tail -20    # confirm it is running
ls -lh backups/                          # confirm files exist and are growing
```

### Restore

**Test this before you need it.** A backup nobody has restored is a hypothesis.

```bash
docker compose stop api
gunzip -c backups/kode_portal_<stamp>.sql.gz | \
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose start api
curl -fsS https://<PORTAL_DOMAIN>/api/v1/health/ready
```

Uploaded files live in the `uploads` Docker volume and are **not** in the SQL
dump. Back them up separately:

```bash
docker run --rm -v kode-portal_uploads:/data -v "$PWD/backups:/backup" \
  alpine tar czf /backup/uploads_$(date -u +%Y%m%d).tar.gz -C /data .
```

## Common incidents

### Nobody can sign in

1. `docker compose ps` — is the API healthy?
2. `curl -fsS https://<domain>/api/v1/health/ready` — is the database up?
3. `docker compose logs api --tail=100` — look for `Invalid environment configuration`.
4. If `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` changed, every session was
   invalidated. That is expected. Users sign in again.

### One person cannot sign in

Almost always account lockout after repeated failures. It clears itself after
`LOGIN_LOCKOUT_MINUTES`. To clear it now, or to issue a temporary password, use
**People → Reset password** in the CMS as a Super Admin.

Check the reason in the audit trail: CMS → Activity trail → filter `LOGIN FAILED`.

### The IT support form succeeds but no email arrives

Notifications go through a transactional outbox, so the ticket is safe; only
delivery failed.

```sql
SELECT id, topic, attempts, last_error, next_attempt_at
FROM outbox_messages WHERE processed_at IS NULL ORDER BY created_at;
```

Fix the SMTP settings and restart the API; the worker retries with exponential
backoff for six attempts. Anything past that is dead-lettered and shows up in
`/health/ready`.

### The site is slow

```bash
docker stats --no-stream
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT pid, state, now()-query_start AS age, left(query,80)
      FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC LIMIT 10;"
```

The API logs any request over one second at `WARN` with its request id.

### Certificate renewal failed

```bash
docker compose logs caddy | grep -i -E "error|certificate"
```

Usually DNS: confirm both domains still resolve to this server and that ports 80
and 443 are open. Caddy retries automatically.

## Routine tasks

### Add a Super Admin

CMS → People → Add person → role **Super Admin**. The temporary password is
shown once; send it over a trusted channel. They must change it at first sign-in.

Do not leave the seeded `admin@kodesportsclub.com` account with its default
password in production.

### Turn on Microsoft sign-in

1. Azure Portal → App registrations → New registration.
2. Redirect URI (Web): `https://<PORTAL_DOMAIN>/api/v1/auth/entra/callback`
3. Certificates & secrets → New client secret.
4. API permissions: `openid`, `profile`, `email`, `User.Read` (delegated).
5. Fill in the `ENTRA_*` values in `.env`, set `ENTRA_ENABLED=true`.
6. `docker compose up -d api`

The sign-in screens show the Microsoft button automatically once the API reports
the provider as enabled.

### Rotate the session secrets

```bash
openssl rand -base64 48   # twice, into JWT_ACCESS_SECRET and JWT_REFRESH_SECRET
docker compose up -d api
```

Everyone is signed out. Do it during a quiet period.

### Investigate who changed something

CMS → Activity trail. Filter by action, and read the field-level diff on the
entry. Every entry carries the actor, IP, user agent and request id; that request
id also appears in the API logs, so you can correlate the two.

## Monitoring

Minimum viable alerting, if you have nothing else:

- Poll `/api/v1/health/ready` every 60s from outside the host; alert on two
  consecutive failures.
- Alert if `backups/` has no new file in 26 hours.
- Alert on disk usage above 80%.
- Watch API logs for `WARN` lines containing `Refresh token replay` — that is a
  possible session theft and deserves a human look.
