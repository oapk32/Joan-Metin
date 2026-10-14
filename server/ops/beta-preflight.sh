#!/usr/bin/env bash
# Read-only private beta preflight. Never prints credentials or changes Oracle.
set -euo pipefail
export LC_ALL=C

say() { printf '\n== %s ==\n' "$1"; }
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
ok() { echo "OK: $*"; }

say "Environment"
if [[ "${EUID}" -eq 0 ]]; then fail "Run as opc, not root"; fi
if [[ -f package.json && -f index.js ]]; then ok "Run directory: server"; else fail "Run in ~/Joan-Metin-MP/server"; fi
if command -v node >/dev/null 2>&1; then
  node_version="$(node -p 'process.versions.node.split(".")[0]')"
  if (( node_version >= 22 )); then ok "Node.js >= 22"; else fail "Node.js >=22 required"; fi
else fail "Node.js is missing"; fi
if command -v git >/dev/null 2>&1; then
  branch="$(git branch --show-current 2>/dev/null || true)"
  [[ "$branch" == "multiplayer-dev" ]] && ok "Branch multiplayer-dev" || fail "Wrong branch: $branch"
  if [[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
    fail "Tracked changes in working copy: review before pull/deploy"
  else ok "No tracked local changes"; fi
else fail "Git is missing"; fi

say "PostgreSQL service and schema (read-only)"
if systemctl is-active --quiet postgresql.service; then ok "PostgreSQL service is active"; else fail "PostgreSQL service is not active"; fi
if sudo -n -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -d joan_metiny -c 'SELECT 1' >/dev/null 2>&1; then
  ok "Local admin can query joan_metiny"
  tables="$(sudo -n -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -d joan_metiny -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('accounts','characters','character_saves','schema_migrations');")"
  echo "Present beta tables: $tables / 4"
  if [[ "$tables" == "4" ]]; then ok "Expected beta tables exist"; else fail "Missing beta tables: inspect BEFORE applying migrations"; fi
  applied="$(sudo -n -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -d joan_metiny -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations';")"
  if [[ "$applied" == "1" ]]; then
    versions="$(sudo -n -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -d joan_metiny -c 'SELECT string_agg(version::text, chr(44) ORDER BY version) FROM public.schema_migrations;')"
    echo "Applied migrations: ${versions:-none}"
    [[ "$versions" == "1,2,3" ]] && ok "Expected migration versions" || fail "Unexpected migrations; inspect schema"
  else fail "Migration history is missing"; fi
else fail "Cannot query local DB as postgres via sudo -n; verify local sudo permission"; fi

say "Backup"
backup_dir="${HOME}/joan-backups"
if [[ -d "$backup_dir" ]]; then
  latest="$(find "$backup_dir" -maxdepth 1 -type f -name 'joan_metiny_*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
  if [[ -n "$latest" ]]; then
    echo "Latest local backup: $(basename "$latest")"
    echo "IMPORTANT: local backup alone is not offsite disaster recovery."
  else fail "No local pg_dump backup in $backup_dir"; fi
else fail "No backup directory; run bash ops/backup-db.sh before migrations"; fi

say "Service configuration"
unit="/etc/systemd/system/joan-online.service"
env_file="/etc/joan-online.env"
if [[ -f "$unit" ]]; then
  ok "systemd unit exists"
  systemctl is-enabled joan-online.service 2>/dev/null || true
  systemctl is-active joan-online.service 2>/dev/null || true
else echo "NOT YET INSTALLED: $unit"; fi
if [[ -f "$env_file" ]]; then
  perms="$(stat -c '%a %U %G' "$env_file" 2>/dev/null || true)"
  if [[ "$perms" == "600 root root" ]]; then ok "Protected /etc/joan-online.env permissions"; else fail "Environment file must be root:root 0600 (observed: $perms)"; fi
else echo "NOT YET CONFIGURED: $env_file"; fi

say "Local HTTP and network safety"
if command -v curl >/dev/null 2>&1; then
  code="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/account/ 2>/dev/null || true)"
  [[ "$code" == "200" ]] && ok "Private account page HTTP 200" || echo "Account page response: ${code:-unreachable} (expected before first start)"
fi
if command -v ss >/dev/null 2>&1; then
  exposed="$(ss -ltnH '( sport = :3000 or sport = :5432 )' | awk '{print $4}' | grep -vE '^((127\.0\.0\.1|\[::1\]|\[::ffff:127\.0\.0\.1\]):[0-9]+)$' || true)"
  if [[ -n "$exposed" ]]; then
    # PostgreSQL might bind to non-loopback locally even with cloud firewall.
    fail "Port 3000 or 5432 listening outside loopback; inspect ss -ltn before any public access."
  else ok "No exposed listener for game/database ports (as observed locally)"; fi
fi

say "Result"
if (( failures > 0 )); then
  echo "$failures preflight problem(s). Fix before starting private beta." >&2
  exit 1
fi
echo "Read-only checks passed. Manual Oracle deploy and two-player testing still required."
