# Joan Metiny Online v0.3 — společné postavy v originálním klientu

Jedná se o **lokální multiplayerový prototyp**, ne hotový veřejný online server.

## První spuštění na Windows
1. Ve složce `Joan-Metin-MP` otevři dvojklikem `SPUSTIT_JOAN.cmd`.
2. Mělo by se otevřít samostatné černé okno serveru a prohlížeč na <http://127.0.0.1:3000/joan/>.
3. V normálním a anonymním okně Chrome vytvoř dvě různé postavy a vyzkoušej pohyb.
4. Vypnutí: v černém okně serveru stiskni **Ctrl+C**.

## Aktualizace z GitHubu
Před aktualizací server vypni (**Ctrl+C**), poté v hlavní složce dvojklik na `AKTUALIZOVAT_JOAN.cmd`. Po dokončení opět `SPUSTIT_JOAN.cmd`.

Ruční postup (ze složky projektu):
```powershell
git pull --ff-only origin multiplayer-dev
cd server
npm.cmd install
npm.cmd run check
npm.cmd test
npm.cmd start
```

## Kamarádi přes internet
Viz [připojení přes soukromou síť Tailscale](../docs/PRIPOJENI_KAMARADU.md). Přístup přes internet povolujeme **pouze důvěryhodným testerům**. Neotvírej port 3000 veřejně.

## Co už jde
- Načíst celou původní hru Joan v134 přes `/joan/`
- Rozpoznat více hráčů ve stejné herní oblasti
- Synchronizovat pozice, jména, povolání a směr pohledu
- Vykreslit ostatní hráče pomocí v134 modelů povolání namísto modrých značek
- Vyhladit síťový pohyb a animovat chůzi
- Základní dvouokenní test, kontrola parity s původní v134

## Co zatím nejde
- Společné HP, monstra, metiny, bossové, souboje, EXP, inventář a loot
- Serverem ověřovaný pohyb v původní herní mapě
- Online účty, bezpečné přihlašování a PostgreSQL persistence
- Veřejný hosting pro 10–30 skutečných hráčů

Server umí sledovat sdílené pozice, ale zbytek stavu hry dál simuluje každý prohlížeč sám. Servery ani klienti **nejsou bezpeční pro otevřený internet** a synchronizaci lze podvrhnout. Sdílené ekonomické odměny proto nejsou zapnuté.
