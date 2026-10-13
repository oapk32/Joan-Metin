# Joan Metiny Online – soukromý test přihlášení (v0.6)

V této verzi vzniká **skutečný účet v PostgreSQL** (`accounts`) a webové přihlášení.
Nejde ještě o uložené online postavy: původní v134 nadále ukládá postup jen v prohlížeči.

**Port 3000 ani 5432 nesmí být otevřený veřejně.** Tento postup používá SSH tunel.

## 1. Aktualizovat na Oracle (terminál `[opc@joan-metiny ...]$`)

```bash
cd ~/Joan-Metin-MP
GIT_SSH_COMMAND='ssh -i ~/.ssh/joan_github -o IdentitiesOnly=yes' git pull --ff-only origin multiplayer-dev
cd server
npm install
npm run check
npm test
```

## 2. Spustit soukromý test na Oracle (tentýž SSH terminál)

```bash
read -r -s -p "Heslo DB joan_app: " PGPASSWORD; echo
export PGPASSWORD
JOAN_AUTH_ENABLED=1 npm start
```

Při psaní hesla se nic nevypisuje. Neposílat heslo ani nikam neukládat do GitHubu.

Po spuštění čekat hlášku `Private account test: http://127.0.0.1:3000/account/`.
Toto okno **nechat otevřené**. Zastavení hry: `Ctrl+C`, potom `unset PGPASSWORD`.

## 3. Otevřít druhý PowerShell **ve Windows**

Zkopírovat příkaz, ale cestu ke klíči upravit podle umístění souboru ve Windows:

```powershell
ssh -i "C:\Users\Ondra\Desktop\Joan-Metin2\ssh-key-2026-10-13.key" -N -L 3000:127.0.0.1:3000 opc@130.61.175.45
```

Pokud jsi Oracle VM mezitím vypnul a znovu zapnul, ověř aktuální veřejnou IP v Oracle Console, protože je *ephemeral*. Tento PowerShell se může tvářit, že nic nedělá; to je správně, tunel zůstává otevřený.

Pokud Windows hlásí, že port 3000 je obsazený, nejdřív zastav lokálně běžící Joan server; tunel musí úspěšně naslouchat na portu 3000.

## 4. Ve Windows prohlížeči

Otevři `http://127.0.0.1:3000/account/`.

Zaregistruj testovací účet (jméno 3–32 znaků A-Z / 0-9 / podtržítko, heslo nejméně 12 znaků).
Po registraci se otevře původní Joan. Pro správu účtu a odhlášení otevři opět `http://127.0.0.1:3000/account/`.

Po logoutu ztrácí herní spojení platnost. Tokeny jsou v paměti Node procesu, takže restart hry odhlásí všechny, ale **účty v PostgreSQL zůstanou**.

## 5. Kontrola účtů v SQL

```bash
sudo -u postgres psql -d joan_metiny -c "SELECT id, username, created_at FROM accounts ORDER BY id;"
```

`password_hash` nevypisuj ani nikam neposílej. Nepoužívat reálná hesla z jiných služeb.

## Stav zabezpečení

- Aktuální server **odmítá aktivovat test účtů při bindu mimo loopback**.
- API kontroluje `Host`, `Origin`, velikost požadavku a limit pokusů.
- Sesion cookie má `HttpOnly`, `SameSite=Strict` a životnost 12 hodin; není `Secure`, protože test běží lokálně přes HTTP uvnitř SSH tunelu.
- Hesla se hashují přes scrypt se solí, neukládají se čitelně.
- V databázi je zatím pouze základ účtů a postav, přičemž **herní postavy zatím nejsou spojeny s online účty**.
- Multiplayerová pozice, boj a kořist jsou pořád klientské a **nejsou důvěryhodné**.
- Před veřejným provozem jsou nutné HTTPS + Secure cookie, serverem řízený boj a ukládání, ochrany proti zneužití, trvalé sessions, zálohy a provozní monitoring.
