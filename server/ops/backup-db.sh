#!/usr/bin/env bash
# Manual PostgreSQL backup. Does not delete/restore data or upload it anywhere.
set -euo pipefail
umask 077

if [[ "$(id -un)" != "opc" ]]; then
  echo "Spusť zálohu jako uživatel opc, bez sudo před bash." >&2
  exit 1
fi
backup_dir="$HOME/joan-backups"
mkdir -p -- "$backup_dir"
chmod 0700 "$backup_dir"
filename="joan_metiny_$(date -u +%Y-%m-%dT%H-%M-%SZ).dump"
tmp="$(mktemp "$backup_dir/.joan-pending-XXXXXX")"
trap 'rm -f -- "$tmp"' EXIT

sudo -u postgres pg_dump --format=custom --no-owner --no-acl --dbname=joan_metiny > "$tmp"
pg_restore --list "$tmp" > /dev/null
mv -- "$tmp" "$backup_dir/$filename"
trap - EXIT
echo "Záloha dokončena: $backup_dir/$filename"
echo "Soubor obsahuje data hráčů a hashe hesel. Neukládej ho na GitHub ani neposílej veřejně."
echo "Pozor: záloha je zatím jen na stejném Oracle disku, není to záloha mimo server."
