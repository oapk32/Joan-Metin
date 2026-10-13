# Joan Metiny Online v0.8 – společná monstra a multiplayerový boj

**Stav:** připraveno na GitHubu ve větvi `multiplayer-dev`. Na Oracle serveru
se nic samo neinstaluje ani nespouští. Nejprve musí projít testy a musí být
nasazené SQL migrace z v0.7.

## První hratelný PvE prototyp

Stránka `/arena/` je malá samostatná testovací aréna se sdílenými monstry
(dva vlci, jeden ork). Není to zatím integrovaný boj v původní hře Joan v134.

- Hráč se přihlásí přes `/account/`, vytvoří online postavu a v seznamu
  stiskne **Vyzkoušet společný boj**.
- Každý WebSocket na `/combat-ws?character=ID` se ověří proti přihlášenému
  účtu a databázi. Není možné připojit stejnou postavu současně dvakrát.
- Server přijímá pouze **pohybové směry** (WASD/šipky) a **pokus o útok**
  (mezerník, kliknutí na monstrum).
- Pozici, rychlost pohybu, dosah útoku, cooldown, HP, poškození a přidělení
  odměn určuje **výhradně server**. Zprávy s klientem dodaným poškozením,
  HP, EXP či Yangy nemohou tyto hodnoty nastavit.
- Monstra se společně pohybují, pronásledují nejbližší živou postavu,
  útočí, umírají a po chvíli se respawnují.
- Za porážku testovacího monstra získají dočasné EXP/Yangy hráči, kteří se
  v posledních deseti sekundách podíleli na jeho poškození.
- Každému oprávněnému hráči se **nezávisle** hází vlastní kořist, kterou
  vidí a může sebrat jen on. V aréně platí dočasné testovací dropy; viz
  [SPOLECNY_SVET_OSOBNI_LOOT.md](SPOLECNY_SVET_OSOBNI_LOOT.md).
- Smrt postavy v aréně → respawn po čtyřech sekundách.

**ZÁSADNÍ:** Testovací EXP, Yangy, osobní loot a zabití jsou pouze v RAM Node.js. **Nezapisují
se do PostgreSQL a po restartu hry zmizí.** Ekonomiku skutečných online postav
chráníme tím, že do databáze se dosud nezapisuje nic z neověřené bojové logiky.

Původní hra v134, její mapy, bossové, inventář, předměty, kouzla a uložení
v prohlížeči se **neměnily**.

## Test po návratu k Oracle

Zatím nic nespuštěj bez předchozího nasazení migrací v0.7. Po přihlášení
do Oracle Linux VM:

```bash
cd ~/Joan-Metin-MP
GIT_SSH_COMMAND='ssh -i ~/.ssh/joan_github -o IdentitiesOnly=yes' git pull --ff-only origin multiplayer-dev
cd server
npm install
npm run check
npm test
bash ops/backup-db.sh
```

Potom po kontrole zálohy použij SQL postup z
[ONLINE_POSTAVY_V07.md](ONLINE_POSTAVY_V07.md). Migrace **nejprve**,
teprve potom test přihlášení.

Při ručním spuštění soukromé arény:

```bash
cd ~/Joan-Metin-MP/server
read -r -s -p "Heslo DB joan_app: " PGPASSWORD; echo
export PGPASSWORD
JOAN_AUTH_ENABLED=1 npm start
```

V druhém PowerShellu na Windows vytvoř SSH tunel podle
[TEST_PRIHLASENI_ORACLE.md](TEST_PRIHLASENI_ORACLE.md), otevři
`http://127.0.0.1:3000/account/`, přihlas se, vytvoř dvě online postavy
a každou otevři v samostatném okně přes odkaz na arénu.

Zastavení ručně spuštěné hry: **Ctrl+C** a potom `unset PGPASSWORD`.

**Nikdy** nevystavuj aktuální port 3000, 5432 nebo webovou registraci
veřejnému internetu. Soukromý test probíhá přes SSH tunel.

## Co je nutné doprogramovat pro plnou hru v134

1. Modely a animace nepřátel i útoků přímo na původních mapách.
2. Serverem řízené skutečné moby/metiny/bossy, kolize, schopnosti a školy.
3. Ověřený inventář, zásahy, drop tabulky a transakční persistentní odměny.
4. Zabezpečené ukládání XP/Yangů a načítání po opětovném přihlášení.
5. Jeden sdílený stav dungeonů a bossů pro všechny hráče, pravidla odměn a zátěžové testy.
   Chat ani party zatím neplánujeme.
6. HTTPS, provozní monitoring a vzdálené zálohy před veřejným přístupem.

## Testy na GitHubu

`server/tests/combat-world.test.js` ověřuje autoritativní HP/damage,
respawn, omezení pohybu, dosah, cooldown a nezávislý osobní loot.

`server/tests/combat-ws.test.js` ověřuje datový protokol, vlastnictví
postavy a odmítnutí současného připojení stejné postavy.

Testy v CI běží na samostatném testovacím stroji; neovlivňují Oracle VM.
