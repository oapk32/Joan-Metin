# Joan Metiny — první online hráči ve světě v134

**Stav:** lokální prototyp. Mapa, lokální souboje a uložené postavy běží původním klientem v134. Online se pouze synchronizuje **pozice a jméno ostatních hráčů ve stejné oblasti**. Jejich podoba je zatím jednoduchý modrý symbol. Nejde zatím o bezpečný produkční multiplayer.

## Aktualizace na Windows
Zastav server pomocí **Ctrl+C** a spusť:

```powershell
cd "$HOME\Downloads\Joan-Metin-MP"
git pull origin multiplayer-dev
cd server
npm.cmd install
npm.cmd start
```

Pak otevři:

- **<http://127.0.0.1:3000/joan/>** — původní Joan v134 s online ukazateli ostatních hráčů
- **<http://127.0.0.1:3000/>** — původní testovací plocha se dvěma kruhy

Otestuj Joan v **jednom normálním a jednom anonymním okně** prohlížeče, vytvoř postavu v obou, aby jejich ukládání bylo oddělené, a nech obě ve stejné oblasti. Pohni s první postavou: ve druhém okně by se měl pohybovat modrý symbol se jménem postavy.

Server naslouchá pouze na `127.0.0.1`; ostatní zařízení se zatím nepřipojí. **Neotevírej port 3000 do internetu.** Prototyp nemá přihlášení ani autorizaci a přijímá pozice od klienta.

## Co funguje
- WebSocket připojení a přidělení síťového ID
- Původní testovací plocha: autoritativní pohyb a 20 Hz aktualizace
- Klient v134: vlastní lokální pohyb a vykreslování, online přenos pozic do stejné oblasti ~8–10×/s
- Jednoduché symboly ostatních hráčů, jejich jména a počet připojených postav v oblasti
- Při běžném samostatném spuštění klienta se bridge sám neaktivuje

## Co zatím nefunguje
- Sdílené příšery, NPC stav, boj, HP, EXP, loot, inventář ani bossové
- Serverově autoritativní pohyb v původním klientovi
- Databáze PostgreSQL a skutečné online účty
- Instance dungeonů a rozdílné realm stavy, bezpečné ukládání, TLS a veřejný hosting
- Testy desítek současných hráčů

## Kontrola syntaxe/parity
V kořeni projektu spusť `python scripts/verify.py`. Ověří identitu v134 mimo dva malé online hooky a syntaxi JavaScriptu. Nezastupuje to reálný herní test.
