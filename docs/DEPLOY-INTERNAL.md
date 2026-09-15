# Deploying on a KODE-internal VM

For a virtual machine on the company network that the internet cannot reach.
The README's deploy section assumes a public host; this is the same stack with
the three things that differ spelled out — certificates, DNS and the firewall.

Everything runs as containers on one VM. There is nothing to install on it
except Docker.

---

## 1. The VM

|           |                                                               |
| --------- | ------------------------------------------------------------- |
| OS        | Ubuntu 22.04 or 24.04 LTS, or Debian 12                       |
| vCPU      | 4                                                             |
| RAM       | 8 GB                                                          |
| Disk      | 80 GB, expandable. Uploads and Postgres both grow.            |
| Network   | A static IP on the company LAN, reachable by employees on 443 |
| Snapshots | Nightly at the hypervisor, retained 7 days                    |

Two vCPU and 4 GB will run it. Four and eight leaves room for the image build,
which is the heaviest thing that happens on this machine.

Install Docker Engine and the Compose plugin from Docker's own repository, not
the distribution's — the distribution's `docker.io` is usually too old for the
Compose v2 syntax this project uses:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in for this to take effect
docker compose version            # must print v2.x
```

---

## 2. Decide two hostnames

The portal and the CMS are separate applications on **separate hostnames**.
They cannot share one. Pick them before you start, because certificates and the
CORS allow-list are both derived from them.

```
portal.kode.internal     the employee portal
cms.kode.internal        the CMS
```

Use a real internal zone your DNS already serves. Avoid `.local` — it collides
with mDNS on macOS and iOS and will fail confusingly on exactly the devices
people use.

Add two A records, both pointing at the VM's IP:

```
portal.kode.internal.   A   10.x.x.x
cms.kode.internal.      A   10.x.x.x
```

For a pilot before DNS is ready, put the same two lines in the testers'
`hosts` files. It works, and it is a bad place to leave things.

---

## 3. Certificates

This is the step that differs most from a public deployment, and the one that
silently fails if you skip it.

Caddy's default is to obtain a public Let's Encrypt certificate. Let's Encrypt
validates by connecting **to your host from the internet**. On an internal VM it
cannot, so it retries and the site serves nothing — with no obvious error beyond
a certificate warning.

Pick one:

**A. Caddy's internal CA — recommended.** Caddy runs its own certificate
authority and issues for your internal names. In `.env`:

```
TLS_MODE=internal
```

Then trust the root on managed devices, once. Export it from the VM:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./kode-root.crt
```

Push `kode-root.crt` to devices through Intune or Group Policy as a trusted
root. Until you do, browsers show a certificate warning — the connection is
encrypted, but nobody should be trained to click through that.

**B. A certificate from the company CA.** If KODE already runs an internal PKI,
issue a certificate covering both hostnames, mount it, and point Caddy at it:

```
tls /etc/caddy/kode.crt /etc/caddy/kode.key
```

in place of `import tls_mode` in both site blocks, with the files mounted into
the `caddy` service. Nothing to trust — the company root is already trusted.

**C. Public certificates for internal names.** Only if the hostnames are in a
public zone you control and you can complete a DNS-01 challenge. That needs a
Caddy image built with your DNS provider's plugin. Do not go here unless you
already know you need it.

After choosing, validate the config before bringing anything up:

```bash
docker run --rm -v "$PWD/infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e PORTAL_DOMAIN=portal.kode.internal -e ADMIN_DOMAIN=cms.kode.internal \
  -e ACME_EMAIL=it@kodesportsclub.com -e TLS_MODE=internal \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

---

## 4. The code and the configuration

```bash
sudo mkdir -p /opt/kode && sudo chown "$USER" /opt/kode
git clone <your-remote> /opt/kode/portal
cd /opt/kode/portal
cp .env.example .env
```

Fill in `.env`. Generate the two secrets rather than inventing them, and make
them different from each other:

```bash
openssl rand -base64 48    # JWT_ACCESS_SECRET
openssl rand -base64 48    # JWT_REFRESH_SECRET
openssl rand -base64 36    # POSTGRES_PASSWORD
```

The values that matter on an internal VM:

| Variable                         | Set it to                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORTAL_DOMAIN` / `ADMIN_DOMAIN` | The two hostnames from step 2                                                                                                                               |
| `TLS_MODE`                       | `internal`, per step 3                                                                                                                                      |
| `ACME_EMAIL`                     | A real KODE address. Still required even when unused.                                                                                                       |
| `COOKIE_DOMAIN`                  | **Leave blank.** Only set it if both hostnames are subdomains of one parent _and_ you want a shared session. Blank gives host-only cookies, which is safer. |
| `COOKIE_SAMESITE`                | `lax`                                                                                                                                                       |
| `IT_SUPPORT_INBOX`               | The mailbox whose rules open the Odoo ticket                                                                                                                |
| `SMTP_*`                         | Your internal relay. Blank logs mail instead of sending it, which means support requests reach nobody.                                                      |
| `ENABLE_SWAGGER`                 | `false`                                                                                                                                                     |
| `SEED_*_PASSWORD`                | Five distinct strong passwords, for first run only                                                                                                          |

`CORS_ORIGINS`, `API_PUBLIC_URL` and the database URL are derived from the above
by `docker-compose.yml`. Do not set them by hand.

The seed **refuses to run in production** unless all five `SEED_*_PASSWORD`
values are set, rather than creating accounts with the known demo password.
That is deliberate. Delete those five lines from `.env` once you have seeded.

Lock the file down — it holds every secret the system has:

```bash
chmod 600 .env
```

---

## 5. First run

```bash
docker compose up -d --build          # first build takes several minutes
docker compose exec api ./node_modules/.bin/prisma migrate deploy
docker compose exec api ./node_modules/.bin/tsx prisma/seed.ts   # first run only
docker compose ps                     # every service healthy
```

Migrations are **not** applied automatically on start. That is deliberate: an
automatic migration on a crash-looping container can apply a half-broken schema
repeatedly. You apply it and you watch it.

Verify before telling anyone it exists:

```bash
curl -fsS https://portal.kode.internal/api/v1/health/ready | jq
```

Then sign in to both hostnames as the Super Admin, and change that password.

---

## 6. Firewall

Caddy publishes 80, 443 and 443/udp. Postgres and the API sit on a Docker
network marked `internal: true` and have no published ports at all — they are
not reachable from the LAN, only from the other containers.

Port 80 stays open: it redirects to 443.

```bash
sudo ufw allow from 10.0.0.0/8 to any port 80,443 proto tcp
sudo ufw allow from 10.0.0.0/8 to any port 443 proto udp
sudo ufw allow from <admin-subnet> to any port 22 proto tcp
sudo ufw enable
```

Narrow `10.0.0.0/8` to the subnets that actually hold employee devices. Do not
expose 5432. Reach the database with `docker compose exec postgres psql`.

---

## 7. Start on boot, and backups

`restart: always` on every service means Docker brings the stack back after a
reboot. Confirm rather than assume — reboot the VM once, before go-live, and
check `docker compose ps`.

The `backup` service writes a nightly `pg_dump` to `./backups` with a retention
window set by `BACKUP_RETENTION_DAYS`. Two things it does not do:

- **It does not back up uploads.** The `uploads` volume holds every file
  anyone has attached. Add it to the hypervisor snapshot, or rsync it.
- **It does not leave the VM.** A backup on the same disk as the database is
  not a backup. Copy `./backups` to the company file server nightly.

Restore is in [RUNBOOK.md](RUNBOOK.md). **Do one now**, into a scratch database,
before this holds real data. A restore nobody has rehearsed is a hope.

---

## 8. Updating

```bash
cd /opt/kode/portal
git pull
docker compose up -d --build
docker compose exec api ./node_modules/.bin/prisma migrate deploy
docker compose ps
```

Rollback is `git checkout <previous-tag>` and rebuild. Application rollback is
safe; **schema rollback is not**, so restore from backup if a release included a
destructive migration.

---

## 9. Microsoft sign-in, when you want it

Local accounts work without any of this. To add Entra ID:

1. Register an application in Azure for the KODE tenant.
2. Set the redirect URI to exactly
   `https://portal.kode.internal/api/v1/auth/entra/callback`.
3. Fill `ENTRA_*` in `.env` and set `ENTRA_ENABLED=true`.
4. `docker compose up -d` and test with one account before announcing it.

Entra must be able to redirect the **browser** there, which it can — the browser
is on the company network. Entra itself never connects to the VM.

---

## Before real employees use it

Two of these are open items from the code review, not optional polish.

- [ ] `pnpm --filter @kode/api test:e2e` has been run against a real
      PostgreSQL 16. It has never been run anywhere. It is the gap between the
      review and a clean bill of health.
- [ ] The taxonomy migration has been applied to a **copy of production data**,
      not only to an empty database, and the news and FAQ categories it produced
      have been eyeballed in the CMS.
- [ ] A restore from `./backups` has been performed successfully.
- [ ] The five `SEED_*_PASSWORD` lines are gone from `.env`, and every seeded
      password has been changed.
- [ ] `.env` is `chmod 600` and is not in version control.
- [ ] The Caddy root is trusted on managed devices, or a company-CA certificate
      is in place.
- [ ] The VM has been rebooted once and the stack came back by itself.
- [ ] `ENABLE_SWAGGER=false`.
