#!/usr/bin/env bash
# Joan Metiny Online: helper for the systemd-managed private beta.
set -euo pipefail

usage() {
  cat <<'HELP'
Použití: bash ops/joanctl.sh PRIKAZ
  status   - stav hry, databáze a místního webu
  start    - zapne Joan (po instalaci systemd služby)
  stop     - vypne Joan, nikoliv celý Oracle server
  restart  - restartuje Joan
  logs     - posledních 50 řádků logu hry
  db       - stav PostgreSQL
  help     - tento tahák
HELP
}
if (( $# > 0 )); then command_name="$1"; else command_name="help"; fi

case "$command_name" in
  start|stop|restart)
    if ! systemctl list-unit-files joan-online.service --no-legend 2>/dev/null | grep -q '^joan-online.service'; then
      echo "Služba joan-online ještě není nainstalovaná. Použij návod docs/SPRAVA_ORACLE.md." >&2
      exit 1
    fi
    sudo systemctl "$command_name" joan-online.service
    sudo systemctl is-active joan-online.service
    ;;
  logs)
    sudo journalctl -u joan-online.service -n 50 --no-pager
    ;;
  db)
    sudo systemctl is-active postgresql.service
    sudo -u postgres psql -d joan_metiny -Atqc 'SELECT current_database(), version();'
    ;;
  status)
    echo "=== Cloudový počítač ==="
    echo "SSH připojení funguje; stav celé VM zkontroluj v Oracle Console."
    echo "=== Databáze PostgreSQL ==="
    sudo systemctl is-active postgresql.service || true
    echo "=== Joan systemd služba ==="
    if systemctl list-unit-files joan-online.service --no-legend 2>/dev/null | grep -q '^joan-online.service'; then
      sudo systemctl is-active joan-online.service || true
      sudo systemctl is-enabled joan-online.service || true
    else
      echo "Služba ještě není nainstalovaná (hra se případně spouští ručně)."
    fi
    echo "=== Joan místní HTTP (port 3000) ==="
    code="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 4 http://127.0.0.1:3000/account/ || true)"
    if [[ "$code" == "200" ]]; then
      echo "200 OK: přihlašovací stránka je dostupná lokálně."
    elif [[ "$code" == "404" ]]; then
      echo "404: běží starší režim hry bez přihlášení, nebo jiná služba."
    elif [[ "$code" == "000" ]]; then
      echo "Žádná odpověď: herní server nejspíš neběží."
    else
      echo "HTTP odpověď: $code (ověř další stav)."
    fi
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
