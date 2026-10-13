# Joan Metiny Online v0.9 – optimalizace bez zásahů do grafiky v134

**Stav:** připravené pouze na GitHubu ve větvi `multiplayer-dev`.
Na Oracle VM zatím žádné změny nenastaly a reálný výkon se ještě musí změřit.

## 1. Sektory map a okolní monstra

Nový `server/combat-interest.js` rozděluje serverové mapy na sektory
o velikosti 220 jednotek. Pro každého připojeného hráče server vybere
jen objekty ve stejné mapě a v okruhu 440 jednotek (sektory slouží jako
urychlující prostorový index).

- Serverový stav mobů zůstává jediný a společný.
- Hráč nedostane vzdálená monstra ani objekty z jiné mapy.
- Při vstupu do arény nebo příchodu nového hráče dostane aktuální stav
  **jen okolních** hráčů a monster.
- `combat-interest.test.js` ověřuje filtrování podle sektoru i mapy.

Zatím je tento systém napojen na **samostatnou PvE testovací arénu**,
nikoliv na všech šest zemí / 36 oblastí a původní monstra v134.
Pro plný svět musí další práce zavést serverové mapové entity a přechody.

## 2. Uspávání prázdných map

`server/combat-world.js` teď podporuje více interních `mapId`,
bez vytvoření soukromých instancí. Přesun postavy mezi nimi může provést
pouze důvěryhodná serverová funkce `transferPlayerMap`; prohlížeč
nemůže přepínat mapu nebo získávat odměny svévolným paketem.

Když na mapě nikdo není:
- její monstra nespouštějí AI ani pohyb;
- zůstávají zachována jejich HP, společný stav a absolutní čas respawnu;
- při návratu hráče se pokračuje ve stejném světě.

Pravidelné hledání nejbližšího hráče stále probíhá **1× za sekundu**
u aktivních / potřebných mobů. Monstrum zasažené útokem hráče se probudí
bez hledání přes všechny hráče. Neaktivní monstra na spawnu spí
mezi sekundovými kontrolami.

## 3. Zvuky načítané až podle potřeby

Původní soubor `client/js/audio-data.js` (přibližně 7,23 MB)
**zůstává beze změny v repozitáři**, stejně jako původní
`client/index.html`. Samostatné otevření v134 nadále používá
vložené offline zvuky.

Když se ale hra otevírá přes Node server na `/joan/`:
- `GET /joan/js/audio-data.js` vrátí jen malé JavaScriptové mapování
  názvů zvuků na URL, ne data všech audio souborů;
- `GET /joan/audio/music` nebo `/joan/audio/crit` a podobně
  poskytují skutečné mediální bajty až na požádání prohlížeče;
- server podporuje HTTP `Range`/206 pro postupné stahování,
  `HEAD`, ETag a privátní cache;
- nepovolené/neznámé názvy zvuků vrátí 404, neexistuje volné
  procházení souborů nebo soukromých dat;
- v režimu s účty stále platí ochrana session pro celé `/joan/`,
  včetně hudebních souborů.

Tím odpadá počáteční stažení celého velkého JavaScriptového zvukového
balíku. Skutečný objem dat při hraní závisí na použitých zvucích.

## 5. Posílání pouze změn monster

WebSocket `/combat-ws` nyní používá:

- `combat-snapshot` – úplný **lokální** seznam po připojení
  nebo připojení další postavy;
- `combat-delta` – v běžném provozu jen přidané, změněné a
  odebrané hráče a monstra v okolí. Pokud se nic nezmění,
  neposílá se žádná zpráva o entitách;
- `combat-loot` – stále jen soukromý loot a testovací batoh
  přihlášené postavy, pouze při změně.

Klient v `server/public/arena.js` lokálně skládá stav ze snapshotu
a delta zpráv. Zobrazení lootů jiného účtu zůstává zakázané.
Žádný nový chat ani party systém nevznikl.

## Nezměněno podle požadavku

**Bod 4 – předkreslování grafiky map / terénu – se neprováděl.**
Grafické algoritmy klienta v134 a `client/js/game.js` jsou beze změny.

## Testy a nasazení

Automatické Node testy prověřují sektorové mapování, rozdíly stavu,
zachování HP a respawnu v prázdné mapě, individuální loot,
WebSocket bezpečnost a částečné audio požadavky. PostgreSQL CI
nadále prověřuje účty a přihlášení.

Pro první nasazení v0.9 na Oracle je nutné **nejprve**:
1. Stáhnout schválenou větev `multiplayer-dev`;
2. Projít zálohování databáze a migrace v0.7;
3. Nainstalovat Node závislosti, spustit testy a pak ruční
   privátní zkoušku v prohlížeči přes SSH tunel;
4. Změřit CPU, RAM, velikost síťových zpráv a skutečné
   časy prvního/dalšího načtení.

Dokud to neprovedeme, jde o **otestovaný kód na GitHubu, nikoliv
prokázanou výkonnost produkčního serveru**.

Další optimalizace může rozložit 1Hz AI hledání mezi různé
herní ticky a zavést sektory přímo do všech původních map,
ale tyto práce nejsou součástí verze 0.9.
