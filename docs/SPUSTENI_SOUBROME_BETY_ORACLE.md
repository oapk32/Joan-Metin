# Soukromá beta na Oracle – plán spuštění 15. 10. 2026

**Cíl:** první soukromý test **samostatné multiplayerové PvE arény** ze dvou PC přes SSH tunel. Účty a výběr online postav jsou v PostgreSQL. EXP, Yangy, zabití, loot na zemi a testovací inventář v aréně **NEJSOU ukládané**; odpojením nebo restartem o ně hráč přijde. Nejde ještě o sdílený boj v mapách v134. Žádný chat ani party.

**Zatím hotovo na GitHubu:** automatické testy PostgreSQL, serverového boje, individuálního lootu, prohlížeče Chromium, 30 hráčů/600 monster v simulaci. CI ověřuje čistý PostgreSQL 16, **ne existující Oracle schéma**. Nikdy nepřeskakovat ruční kontrolu DB.

**Nenasazujeme automaticky.** Níže jsou příkazy pro člověka připojeného jako `opc` přes SSH k existující Oracle VM. Nikdy neposílat DB heslo ani SSH klíč do chatu/GitHubu. Porty 3000 a 5432 se veřejně neotevírají.

## Příprava: aktuální stav bez změn

V PowerShellu ve Windows se připoj k aktuální veřejné IP Oracle VM:

```powershell
ssh -i "CESTA_K_TVEMU_SOUKROMEMU_KLICI" opc@AKTUALNI_IP_ORACLE
```

Na Oracle:

```bash
cd ~/Joan-Metin-MP
git status --short
git branch --show-current
systemctl is-active postgresql.service
sudo -u postgres psql -X -d joan_metiny -c "\dt public.*"
sudo -u postgres psql -X -d joan_metiny -c "SELECT to_regclass('public.schema_migrations');"
```

Pokud `git status` ukazuje změněné soubory, **nepřepisovat je**. Před první migrací podrobně porovnat existující ručně vytvořené tabulky `accounts`, `characters`, `character_saves` a oprávnění `joan_app` s migracemi v repozitáři. **Automatické testy nezaručují kompatibilitu starších ručních Oracle tabulek.**

## 1. Zapamatuj si starou verzi a stáhni novou

```bash
cd ~/Joan-Metin-MP
git rev-parse HEAD
git status --porcelain
GIT_SSH_COMMAND='ssh -i ~/.ssh/joan_github -o IdentitiesOnly=yes' git fetch origin multiplayer-dev
git switch multiplayer-dev
GIT_SSH_COMMAND='ssh -i ~/.ssh/joan_github -o IdentitiesOnly=yes' git pull --ff-only origin multiplayer-dev
git rev-parse HEAD
cd server
npm install --no-audit --no-fund
npm run check
npm test
node combat-benchmark.mjs
```

**Poznámka:** `git switch` může odmítnout přepnutí, jsou-li lokální změny. Nenahrazovat to násilným `reset --hard`.

Před nasazením si ulož předchozí commit z `git rev-parse HEAD` mimo repozitář (např. do soukromých poznámek). Návrat k předchozí verzi nikdy nemá mazat nebo vracet data v PostgreSQL bez odděleného plánu.

## 2. Povinná DB záloha a ruční kontrola schématu

```bash
cd ~/Joan-Metin-MP/server
bash ops/backup-db.sh
ls -lh ~/joan-backups/
sudo -u postgres psql -X -d joan_metiny -c "\d+ public.accounts"
sudo -u postgres psql -X -d joan_metiny -c "\d+ public.characters"
sudo -u postgres psql -X -d joan_metiny -c "\d+ public.character_saves"
sudo -u postgres psql -X -d joan_metiny -c "SELECT * FROM public.schema_migrations ORDER BY version;"
```

Některé dotazy mohou chybějící tabulku nahlásit jako chybu – právě proto se **nejprve kontroluje**, co na Oracle skutečně existuje. Existuje-li jiný formát tabulek nebo schází historie migrací, **zastavit se a upravit migrační plán**, neprovádět ho naslepo. Soubor dumpu obsahuje soukromá data; nikdy ho neposílat do chatu ani na veřejný GitHub.

Teprve po potvrzení kompatibility a dokončené záloze aplikovat migrace:

```bash
cd ~/Joan-Metin-MP/server
set -o pipefail
node migrations/migrate.js | sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d joan_metiny
```

Znovu spuštěné migrace se mají bezpečně přeskočit, protože používají historii kontrolních součtů. Neočekávanou chybu nepřekonávat ručním mazáním tabulek.

## 3. Konfigurace soukromé Node služby

Služba používá `server/ops/joan-online.service`. Před spuštěním musí existovat bezpečný soubor `/etc/joan-online.env`, vlastněný `root:root`, práva `0600`, s těmito proměnnými:

```ini
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=joan_metiny
PGUSER=joan_app
PGPASSWORD=ZADAT_PRIMO_NA_ORACLE_MIMO_CHAT
```

Tento blok je **šablona, ne soubor k uložení do GitHubu**. Pro bezpečné zadání použij přímo na Oracle `sudoedit /etc/joan-online.env`, kde heslo nebude vystaveno v terminálovém příkazu. Potom:

```bash
sudo chown root:root /etc/joan-online.env
sudo chmod 0600 /etc/joan-online.env
sudo install -m 0644 ~/Joan-Metin-MP/server/ops/joan-online.service /etc/systemd/system/joan-online.service
sudo systemctl daemon-reload
```

**Před spuštěním** přesvědč se, že `/etc/joan-online.env` neobsahuje ukázkové heslo a že aplikace má v PostgreSQL odpovídající roli `joan_app` s omezenými oprávněními.

## 4. Spustit a ověřit pouze localhost

```bash
sudo systemctl enable --now joan-online.service
cd ~/Joan-Metin-MP/server
bash ops/joanctl.sh status
bash ops/beta-preflight.sh
sudo journalctl -u joan-online.service -n 50 --no-pager
curl --noproxy '*' -i http://127.0.0.1:3000/account/
ss -ltn '( sport = :3000 or sport = :5432 )'
```

`beta-preflight.sh` je **read-only**, má ukončit běh chybou, pokud schází DB migrace, záloha nebo se porty poslouchají mimo loopback. Pokud selže, neopravovat to otevřením portů do internetu. **Když PostgreSQL na stroji poslouchá veřejně, nejdřív prověřit jeho bind a cloud firewall.**

V případě chyby:

```bash
sudo systemctl stop joan-online.service
sudo journalctl -u joan-online.service -n 100 --no-pager
```

Zastavení služby nemění databázi. Nevypínat PostgreSQL ani VM.

## 5. Herní test na PC (nikoliv mobilu)

V novém PowerShell okně na PC nechat běžet tunel:

```powershell
ssh -i "CESTA_K_TVEMU_SOUKROMEMU_KLICI" -N -L 3000:127.0.0.1:3000 opc@AKTUALNI_IP_ORACLE
```

V prohlížeči otevřít `http://127.0.0.1:3000/account/`. Zaregistrovat testovací účet (heslo nepoužívat jinde); online postavu vytvořit na stránce účtu a kliknout na **Vyzkoušet společný boj**. Druhý PC může mít vlastní SSH tunel s vlastním lokálním portem; přístup vyžaduje povolené SSH a oprávnění, nikdy nesdílet soukromý SSH klíč. Dvě postavy musí patřit různým účtům. Případně pro první test stačí dva oddělené profily prohlížeče na jednom PC s jedním tunelem.

### Ruční checklist

- [ ] Přihlášení funguje pro oba účty; nepřihlášený hráč se do arény nedostane.
- [ ] Dvě odlišné postavy se vidí ve stejném prostoru.
- [ ] Oba vidí stejná společná HP vlka a stejné úmrtí/respawn.
- [ ] Při dosažení boje hráči dostanou každý vlastní šanci na drop.
- [ ] Cizí drop nejde vidět ani sebrat; vlastní jde zvednout klávesou `E`.
- [ ] Nezvednutý loot zmizí po 120 sekundách.
- [ ] Testovací EXP/Yang/loot se **neukládají**, nejsou slibovány trvalé odměny.
- [ ] Ve službě nejsou chyby a Oracle nemá nadměrné CPU/RAM.
- [ ] Po restartu služby účty/postavy zůstanou v PostgreSQL; arénové odměny zmizí podle záměru.

## 6. Návrat k předchozímu hernímu kódu

Pokud nová verze selže:

```bash
sudo systemctl stop joan-online.service
cd ~/Joan-Metin-MP
git status --short
# Nejprve prověřit, že nejsou rozpracované lokální změny.
# Pak přejít na přesně zaznamenaný dřívější commit:
git switch --detach PREDCHOZI_ZAZNAMENY_COMMIT
cd server
npm install --no-audit --no-fund
npm run check
npm test
```

Dřívější commit se musí vložit **ručně podle uloženého SHA**; žádné automatické `reset --hard`. **DB migrace nevracet automaticky.** Pokud starý kód nepodporuje aktualizované schéma, zůstat se službou vypnutou a nejprve bezpečně ověřit kompatibilitu. Obnovení dat z `pg_dump` je samostatná operace s rizikem přepsání účtů; nikdy ho nespouštět jen kvůli chybě Node procesu.

Po ověření lze vrátit vývojovou větev pomocí `git switch multiplayer-dev`.

## Co tato beta není

- Není veřejně přístupná hotová hra; porty zůstávají místní.
- Nejde o serverový boj ve všech původních mapách v134.
- Postup z arény, inventář, dropy, EXP a Yangy nejsou trvalé.
- Není to dlouhodobý production monitoring a zátěžový test proběhl na GitHubu, ne na Oracle.
