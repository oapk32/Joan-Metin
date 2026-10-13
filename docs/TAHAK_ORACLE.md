# Joan Metiny Online – PROVOZNÍ TAHÁK (Oracle Linux 9)

## 0. Co je co
- **Oracle VM** = zapnutý cloudový počítač. Jeho adresa může být změněna při zastavení/znovuspuštění, protože aktuální public IPv4 je *ephemeral*.
- **PostgreSQL** = databázová služba, již automaticky zapíná systemd.
- **Joan Node.js** = multiplayerový prototyp; **zatím nemá systemd službu**, takže příkaz `npm start` ho spustí jen v otevřeném SSH terminálu.
- **GitHub multiplayer-dev** = zdroj kódu, nikoli web pro hráče.
- SSH přihlášení z Windows: `ssh -i "CESTA_K_SSH_KLICI.key" opc@AKTUALNI_VEREJNA_IP`. Soukromý klíč nikomu neposílat.

## 1. Připojení, odpojení
- Přihlášení: SSH z PowerShellu pomocí soukromého klíče a aktuální veřejné IP Oracle.
- Odpojení: `exit`. **Nevypíná Oracle VM ani PostgreSQL**.

## 2. Stav
```bash
sudo systemctl is-active postgresql
sudo systemctl status postgresql --no-pager
curl -I --max-time 5 http://127.0.0.1:3000/joan/
```
U `curl`: HTTP 200 = Joan HTTP proces naslouchá lokálně; chyba spojení = prototyp není spuštěn. HTTP 200 **není důkaz**, že hra a databáze fungují nebo že je vše bezpečné.

## 3. Hra – dočasné ruční ovládání
```bash
cd ~/Joan-Metin-MP/server
npm start
```
Zastavení: Ctrl+C **v terminálu s běžící hrou**. Dokud není systemd služba, není trvalé spouštění nastaveno. Port 3000 a databázový port 5432 **neotevírat do internetu**.

## 4. PostgreSQL
```bash
sudo systemctl is-active postgresql
sudo systemctl restart postgresql
sudo journalctl -u postgresql -n 50 --no-pager
sudo -u postgres psql -d joan_metiny
```
Uvnitř `psql`:
```sql
\dt
SELECT COUNT(*) FROM accounts;
\q
```
SQL migrace a schéma musí zůstat pod verzovací kontrolou. Nepoužívat `DROP` bez zálohy.

## 5. Aktualizace kódu
```bash
cd ~/Joan-Metin-MP
GIT_SSH_COMMAND='ssh -i ~/.ssh/joan_github -o IdentitiesOnly=yes' git pull --ff-only origin multiplayer-dev
cd server
npm install
npm test
```
Nový kód se u běžící Node.js služby projeví až po jejím restartu. Až vznikne systemd služba, doplníme zde přesný restart příkaz.

## 6. Diagnostika
```bash
node -v
npm -v
git --version
sudo systemctl is-active postgresql
sudo journalctl -u postgresql -n 50 --no-pager
cd ~/Joan-Metin-MP/server && npm test
```
Při potížích kopírovat **pouze chybové hlášky bez hesel, soukromých SSH klíčů a session tokenů**.

## 7. Celý Oracle počítač
Oracle Cloud Console → Compute → Instances → Joan-Metiny-Online:
- Start / Stop / Reboot spravují **celou VM**, ne jen hru.
- Stop není potřeba po každé práci; PostgreSQL bude dostupná, pokud VM běží.
- Při používání *ephemeral* public IP ověřit veřejnou IP po zastavení a znovuspuštění VM.
- Oracle Always Free platí jen při splnění limitů a podmínek pro zvolené prostředky; stav a fakturaci kontrolovat v Oracle Console.

## 8. Co ještě nemáme
- bezpečné účty / registraci / herní session
- ukládání a načítání postav přes autentizovaná API
- serverem řízený boj, EXP a dropy
- HTTPS doménu, reverzní proxy a ochranu proti zneužití
- systemd službu hry a automatické DB zálohy

Prototyp nevystavovat na veřejnou IP.
