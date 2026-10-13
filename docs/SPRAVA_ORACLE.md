# Joan Metiny Online – správa Oracle pro začátečníky

Stav: systémové skripty jsou připravené ve větvi `multiplayer-dev`.
**Služba `joan-online` ještě není nainstalovaná na Oracle VM.**
Je nutná jednorázová instalace, kterou provedeme spolu až u SSH terminálu.
Nikdy neotvírej veřejně port 3000 ani 5432.

## Co je třeba vědět (TL;DR)

`exit` odhlásí SSH, **nevypíná cloud**. Počítač lze klidně vypnout;
Oracle a PostgreSQL běží dál.

Příkaz pro diagnostiku, který funguje i **před instalací** systemd služby:

```bash
cd ~/Joan-Metin-MP/server
bash ops/joanctl.sh status
```

Po jednorázové instalaci systemd služby bude ovládání jednoduché:

| Co chci | Příkaz po SSH přihlášení |
| --- | --- |
| Zapnout hru | `cd ~/Joan-Metin-MP/server && bash ops/joanctl.sh start` |
| Vypnout hru (ne Oracle) | `cd ~/Joan-Metin-MP/server && bash ops/joanctl.sh stop` |
| Restartovat hru | `cd ~/Joan-Metin-MP/server && bash ops/joanctl.sh restart` |
| Stav hry a DB | `cd ~/Joan-Metin-MP/server && bash ops/joanctl.sh status` |
| Chyby hry | `cd ~/Joan-Metin-MP/server && bash ops/joanctl.sh logs` |
| Stav databáze | `cd ~/Joan-Metin-MP/server && bash ops/joanctl.sh db` |
| Ruční DB záloha | `cd ~/Joan-Metin-MP/server && bash ops/backup-db.sh` |

Když je služba nainstalovaná a zapnutá, po restartu VM se spouští sama.
Pro totální vypnutí/zapnutí Oracle VM jdi do Oracle Cloud Console →
Compute → Instances → Joan-Metiny-Online → Stop / Start.

**Aktuální public IP je ephemeral a může se změnit** po zastavení/startu VM.
SSH vždy směřuj na aktuální veřejnou IP z Oracle Console.

## Jednorázové zprovoznění služby – až u počítače

1. Přihlásit se přes SSH do Oracle.
2. Stáhnout aktuální větev `multiplayer-dev` z GitHubu a spustit `npm install`, `npm test`.
3. Vytvořit na Oracle soubor `/etc/joan-online.env` vlastněný `root:root`
   s oprávněním `0600`. Do něj nastavit `PGHOST=127.0.0.1`,
   `PGDATABASE=joan_metiny`, `PGUSER=joan_app`, `PGPASSWORD` a `PGPORT=5432`.
   **Heslo nikdy nevkládat do repozitáře ani neposílat v chatu.**
   Při konfiguraci spolu zvolíme vhodný způsob skrytého zadání.
4. Nainstalovat soubor služby a povolit ji:

```bash
sudo install -m 644 ~/Joan-Metin-MP/server/ops/joan-online.service /etc/systemd/system/joan-online.service
sudo systemctl daemon-reload
sudo systemctl enable --now joan-online
```

5. Stav a případné chyby:

```bash
sudo systemctl status joan-online --no-pager
sudo journalctl -u joan-online -n 50 --no-pager
```

**Výše uvedený krok 4 zatím nespouštěj, protože ještě nemáme soubor s DB heslem!**
Tento návod je připraven pro společné zprovoznění.

## Manuální zálohování databáze

```bash
cd ~/Joan-Metin-MP/server
bash ops/backup-db.sh
```

Skript vytvoří lokální `~/joan-backups/joan_metiny_DATUM.dump`
se soukromými oprávněními a ověří formát. Obsahuje účty včetně hashů
hesel; nepublikovat ho ani jej nahrávat na GitHub.

**Toto není záloha mimo server**; ztráta celé Oracle VM by znamenala
ztrátu databáze i těchto lokálních záloh. Později nastavíme bezpečný
šifrovaný export na jiné úložiště a nacvičíme obnovení.

## Aktualizace z GitHubu

```bash
cd ~/Joan-Metin-MP
GIT_SSH_COMMAND='ssh -i ~/.ssh/joan_github -o IdentitiesOnly=yes' git pull --ff-only origin multiplayer-dev
cd server
npm install
npm run check
npm test
```

Po testech a **po instalaci služby**:

```bash
sudo systemctl restart joan-online
```

V přípravné fázi je lepší aktualizovat pod dohledem a případně udělat
ruční zálohu, než automaticky nasazovat každou změnu.

## Bezpečnost a stav projektu

Služba je pro účty navržená pouze pro `127.0.0.1:3000`.
K otestování webu potřebuješ SSH tunel; viz
[TEST_PRIHLASENI_ORACLE.md](TEST_PRIHLASENI_ORACLE.md).

Dnešní prototyp není veřejný produkční multiplayer: chybí HTTPS,
autoritativní boj, online ukládání postav, trvalé přihlášení a správa záloh.
