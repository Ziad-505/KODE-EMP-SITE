#!/bin/sh
# Nightly logical backup with retention. Runs as a long-lived container rather
# than host cron so the schedule travels with the stack.
set -eu

RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p /backups

run_backup() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="/backups/kode_portal_${stamp}.sql.gz"
  echo "[backup] starting ${target}"
  if pg_dump --clean --if-exists --no-owner --no-privileges | gzip -9 > "${target}.partial"; then
    mv "${target}.partial" "${target}"
    echo "[backup] wrote ${target} ($(du -h "${target}" | cut -f1))"
  else
    echo "[backup] FAILED" >&2
    rm -f "${target}.partial"
    return 1
  fi
  find /backups -name 'kode_portal_*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
}

# One immediately so a fresh deployment is covered, then daily at 02:15 UTC.
run_backup || true

while true; do
  now="$(date -u +%s)"
  today_target="$(date -u -d 'today 02:15' +%s 2>/dev/null || echo 0)"
  if [ "$today_target" -le "$now" ]; then
    next="$(date -u -d 'tomorrow 02:15' +%s 2>/dev/null || echo $((now + 86400)))"
  else
    next="$today_target"
  fi
  sleep "$((next - now))"
  run_backup || true
done
