# Joan Metiny Online v0.7 – online postavy a bezpečný základ ukládání

**Stav:** kód a SQL jsou pouze na GitHubu ve větvi `multiplayer-dev`.
**Oracle server zatím běží na dosud stažené verzi v0.6**; migrace na něm
neproběhly. Nic se automaticky nenasazuje.

## Co nová verze umí

- Registrace a přihlášení dál pracují s PostgreSQL tabulkou `accounts`.
- Přihlášený hráč může na `/account/` založit až 6 online postav.
- Každá postava patří jednomu účtu. API vždy filtruje podle
  `account_id` ze serverové session, nikoli podle klientem zadaného ID účtu.
- `GET /api/characters` – přehled vlastních postav.
- `POST /api/characters` – vytvoření postavy: jen `name` a `class`.
- `GET /api/characters/:id` – vlastní postava, včetně uloženého snapshotu.
- Klientské `PATCH`, `PUT`, `DELETE` nejsou povoleny. Hráč nemůže požádat
  server o přidání EXP, Yangů či inventáře prostým odesláním JSON.
- Modul `server/characters.js` připravuje `saveServerProgress(...)`, který
  provede uložení ve **jedné transakci**. Současně kontroluje vlastnictví a
  `revision`, takže starší save nemůže přepsat novější. Použití tohoto zápisu
  je pouze pro budoucí **serverem vypočítávaný** postup hry.

## Co se zatím NEUKLÁDÁ online

Původní Joan v134 pořád běží jako singleplayerová logika v prohlížeči.
Jeho batoh, EXP, Yangy, questy a uložené postavy v localStorage **nejsou**
automaticky přesunuty do PostgreSQL. Nové online postavy jsou zatím jen
samostatný seznam u herního účtu. Nepoužívej je zatím místo starých záloh.

Další vývoj: herní výběr online postavy, serverem řízené souboje/odměny,
mapování reálného inventáře, zabezpečený import existujících postav,
průběžné ukládání a ověření obnovení stavu po restartu.

## Databázové migrace

`server/migrations/001_baseline.sql` – bezpečně respektuje existující
ručně založené tabulky `accounts` a `characters`.

`server/migrations/002_character_saves.sql` – pouze **přidává** sloupce
`revision`, `updated_at`, index a tabulku `character_saves` se snapshotem
JSONB (do 256 KiB), typem schématu a časem uložení.

`server/migrations/003_least_privilege.sql` – odebere aplikaci zbytečná
oprávnění DELETE k účtům a postavám a UPDATE k účtům. Stávající
data ani hesla nemění.

`server/migrations/migrate.js` – generuje SQL pro `psql`:
- každá migrace se provede v transakci pod PostgreSQL advisory lockem;
- historie `schema_migrations` uchovává číslo, název a SHA-256 kontrolní součet;
- opakovaný běh přeskočí již provedené migrace;
- pokud někdo změní dříve provedený soubor, migrátor se zastaví.

**Přesné kroky na Oracle až zítra, po ověření v CI:**

```bash
# 1. Přihlásit se přes SSH jako opc a stáhnout větev multiplayer-dev
cd ~/Joan-Metin-MP
GIT_SSH_COMMAND='ssh -i ~/.ssh/joan_github -o IdentitiesOnly=yes' git pull --ff-only origin multiplayer-dev
cd server
npm install
npm run check
npm test

# 2. Nejprve bezpečná ruční záloha
bash ops/backup-db.sh

# 3. Migrovat jako PostgreSQL administrátor, s ukončením při jakékoli chybě
set -o pipefail
node migrations/migrate.js | sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d joan_metiny
```

**Důležité:** Tento postup zatím neprováděj bez společné kontroly výsledků testů
a zálohy. Migrace SQL nikdy nemaž ani neupravuj po aplikování.
Heslo `joan_app` ani SSH klíče se neposílají do Gitu.

## SQL kontroly po nasazení

```bash
sudo -u postgres psql -d joan_metiny -c "SELECT version, name, applied_at FROM schema_migrations ORDER BY version;"
sudo -u postgres psql -d joan_metiny -c "SELECT id, account_id, name, class, level, revision FROM characters ORDER BY id;"
sudo -u postgres psql -d joan_metiny -c "SELECT character_id, revision, saved_at FROM character_saves;"
```

Tyto příkazy neukazují žádná hesla. Obnova databáze ze zálohy musí být před
veřejným spuštěním alespoň jednou vyzkoušena na oddělené testovací databázi.

## Bezpečnostní hranice

Aktuální účtový režim funguje jen na `127.0.0.1` přes SSH tunel,
nikoliv na veřejné IP. Databáze zůstává nedostupná z internetu.
Snapshoty inventáře a ekonomiky mohou bezpečně vznikat teprve z ověřených
serverových herních událostí; klientskou kopii v134 nelze bez další práce
považovat za důvěryhodnou.
