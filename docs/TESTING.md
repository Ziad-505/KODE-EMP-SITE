# How to test this

A script for confirming the system does what it claims. Roughly 20 minutes.

## 0. Prerequisites

- **Docker Desktop** running (Windows: with the WSL2 backend)
- **Node 22** and **pnpm 9** (`corepack enable` installs pnpm)

Extract the project **outside OneDrive**. `node_modules` is around 500 MB of
small files; letting OneDrive sync it makes installs slow and can corrupt them.
`C:\dev\kode-portal` is a good home.

## 1. Start it

```bash
pnpm install
make dev          # Windows without make: .\setup.ps1
make seed         # in a second terminal, once the API reports ready
```

|              |                                |
| ------------ | ------------------------------ |
| Portal       | http://localhost:5173          |
| CMS          | http://localhost:5174          |
| API docs     | http://localhost:4000/api/docs |
| Mail catcher | http://localhost:8025          |

## 2. Confirm the build is sound

```bash
pnpm verify
```

Typecheck, lint, format check, 49 unit tests and 34 bootstrap tests. All of it
should pass before you judge anything else.

## 3. The permission model

This is the part worth testing carefully, because it is the part that would be
expensive to get wrong. Every account below uses the password
`KodeClub!2026demo`.

### Employee cannot reach the CMS

Sign in at **:5174** as `employee@kodesportsclub.com`. Expect a clear "No CMS
access" screen, not an empty shell. Sign in at **:5173** with the same account
and the portal works normally.

### Content Editor cannot publish

Sign in at **:5174** as `editor@kodesportsclub.com`.

1. News → **New news story**. Fill in a title and body.
2. In the Publication panel, open the Status dropdown. **Published** and
   **Archived** are disabled and labelled "needs a Content Manager".
3. Set it to **In review** and save.
4. Back on the News list, open the row menu. The **Published** and **Archived**
   buttons show a padlock and are disabled.
5. **The real test:** set Status to Published in the browser devtools by
   removing the `disabled` attribute, then save. The server forces it back to
   **In review**. That is the point: the UI is a courtesy, the API is the rule.

### Content Manager can publish, but not administer

Sign in as `marketing@kodesportsclub.com`.

1. Find the editor's story, open the row menu, click **Published**. It goes live.
2. Open **:5173/news** in another tab. The story is there.
3. In the sidebar, **People**, **Activity trail** and **System access** are
   greyed out and marked LOCKED.
4. Try the URL directly: `http://localhost:5174/audit`. You get "Not available
   to your role", and the API returns 403.

### Department Editor sees only their own team

Sign in as `operations@kodesportsclub.com`.

1. A purple banner explains the scope.
2. The list shows Operations content plus club-wide items.
3. Create a policy: the Department field is fixed to Operations and cannot be
   changed to club-wide.

### Super Admin

Sign in as `admin@kodesportsclub.com`. Everything is available. Go to **People**
and try to deactivate your own account: the button is not there. Try to demote
yourself: the Role dropdown is disabled on your own row.

## 4. The audit trail

As the Super Admin, open **Activity trail**. Every action from the steps above
is listed with the actor, IP, timestamp and a field-level diff.

Then prove it cannot be rewritten:

```bash
make psql          # Windows: docker compose -f docker-compose.dev.yml exec postgres psql -U kode -d kode_portal
UPDATE audit_logs SET summary = 'tampered' WHERE id = (SELECT id FROM audit_logs LIMIT 1);
```

Expect:

```
ERROR:  audit_logs is append-only; UPDATE is not permitted
```

## 5. The IT support flow

On the portal as any user, go to **IT support** and submit a request. You get a
reference like `KODE-IT-000001` immediately. Open http://localhost:8025 and the
email to the IT inbox is there, in the plain key/value format Odoo parses.

To prove the transactional outbox: stop Mailpit
(`docker compose -f docker-compose.dev.yml stop mailpit`), submit another ticket,
and confirm the ticket still saves. Start Mailpit again and the email arrives
within 30 seconds without you doing anything.

## 6. Uploads

CMS → **Media library**. Upload an image; it appears. Then:

```bash
# a text file wearing a .png costume
printf '<?php system($_GET[0]); ?>' > evil.png
```

Upload it. Rejected with "The file contents do not match its type." The browser
declared `image/png`; the server read the actual bytes.

## 7. Sessions

Sign in on the portal, then in devtools → Application → Cookies:

- `kode_at` and `kode_rt` are **HttpOnly**. JavaScript cannot read them, so an
  XSS bug cannot steal the session.
- `kode_rt` has `Path=/api/v1/auth`, so it is not sent on ordinary API calls.
- `kode_csrf` is readable. That one is meant to be.

Delete `kode_at` only, then navigate. The page still works: the client silently
refreshed using `kode_rt`. Now delete both and navigate: you land on sign-in.

## 8. The correctness fixes from the review

- **Sticky:** on the portal homepage, scroll to "Fresh from the floor." The
  heading pins while the story list scrolls past it.
- **Mobile navigation:** narrow the window under 850px. A menu button appears
  and opens a drawer with all nine destinations. The old draft had none.
- **CMS on mobile:** narrow **:5174** under 650px. The sidebar becomes a bottom
  tab bar. The old draft showed nothing at all.
- **Hero at 390px:** the "ENTER THE PULSE" button is no longer covered by the
  decorative tags.
- **Filter and selection:** in the CMS news list, open a row's menu, then switch
  the filter to Draft. The menu closes rather than reattaching to a different
  item.

## 9. When you are done

```bash
make down          # stops the containers, keeps the data
make reset         # wipes and reseeds the database
```

## If something goes wrong

```bash
docker compose -f docker-compose.dev.yml ps        # is everything healthy?
docker compose -f docker-compose.dev.yml logs api  # what did the API say?
curl http://localhost:4000/api/v1/health/ready     # is the database reachable?
```

The most common first-run problems are Docker Desktop not running, port 5432
already taken by a local PostgreSQL, and extracting the project inside a synced
OneDrive folder.
