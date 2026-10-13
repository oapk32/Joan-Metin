# Joan Metiny Online v0.9 – výsledky funkčních a zátěžových testů

Datum ověření: 14. října 2026 (po změnách v multiplayer-dev).
Vše proběhlo na **izolovaném testovacím prostředí GitHub Actions**,
s dočasným PostgreSQL 16 a headless Chromium.
**Žádné nasazení ani testy na Oracle VM se neprovedly.**

[Poslední úspěšný běh všech testů](https://github.com/oapk32/Joan-Metin/actions/runs/38480081559).

## Co skutečně prošlo

| Oblast | Test | Výsledek |
| --- | --- | --- |
| Účet | Registrace přes formulář v Chromium a ověřená session | Prošlo |
| Databáze | Tři migrace, opakované spuštění, omezená oprávnění, vlastnictví postav | Prošlo |
| Postavy | Vytvoření online postavy z prohlížeče, seznam postav u účtu | Prošlo |
| Hra v134 | Otevření stránky, spuštění klientského JavaScriptu v Chromium | Prošlo jako smoke test |
| Zvuk | Načtení audio manifestu a částečný HTTP 206 požadavek na hudbu | Prošlo |
| Multiplayer | Dva skutečné prohlížeče s oddělenými účty a postavami v aréně | Prošlo |
| Boj | Klávesnicový pohyb a zásah monstra, změna HP viditelná druhému hráči | Prošlo |
| Sektory | Vzdálený ork se neodesílá, blízký vlk ano; změny jdou jako delta | Prošlo |
| Osobní loot | Samostatné hody, skrytí a zamítnutí cizí kořisti, expirace 120 s | Prošlo v serverových testech |
| Uspávání map | Zachování HP/respawnu, prázdné mapy bez běhu AI | Prošlo v simulaci |

Prohlížečový test: `server/browser-smoke.mjs`, spouští ho workflow
`.github/workflows/multiplayer-checks.yml`. Serverová E2E sada
`server/tests/combat-auth.e2e.test.js` kontroluje autorizaci WebSocketů
na skutečném PostgreSQL. Dále běží unit testy monster, vlastního lootu,
delta synchronizace a audiostreamingu.

## Benchmark: 30 hráčů a 600 monster

Skript `server/combat-benchmark.mjs`: 30 simulovaných hráčů, 600 monster,
4 mapy, 400 herních ticků představujících 20 sekund hry. V tomto scénáři
je obsazená jen jedna mapa, ostatní 3 spí. Tedy **150 monster na aktivní
mapě a 450 na spících mapách**, nikoliv 600 bojujících současně.

| Metrika v GitHub Actions | Před optimalizací | Po optimalizaci |
| --- | ---: | ---: |
| 50. percentil ticku | 0,030 ms | 0,013 ms |
| 95. percentil ticku | 72,235 ms | 1,698 ms |
| 99. percentil ticku | 81,064 ms | 3,018 ms |

Nový běh (po odstranění zbytečného řazení entit pro každého hráče)
dále ukazuje 3 000 plných kontrol cílů, 3 spící mapy,
3 930 odesílaných delta zpráv a 8 167 563 bajtů těchto zpráv
za 20 simulovaných herních sekund. Hodnoty se mohou mezi běhy lišit.

**Důležité:** Jsou to časy naměřené na GitHub Actions runneru,
nikoliv 1OCPU Oracle ARM VM; nejde o garanci FPS/latence na ostrém serveru.
Test není 30 současně hrajících skutečných prohlížečů a nevyhodnocuje
600 aktivně bojujících monster. Naměřený výkon je pozitivní, ale
provozní rozhodnutí vyžaduje test na cílovém Oracle stroji.

## Co dosud není potvrzené

- Skutečné nasazení v0.9 a databázových migrací na Oracle;
- dvě hráčské relace přes veřejné zabezpečené HTTPS – port je stále jen místní;
- skutečné monstra, questy, inventář a souboje v mapách původní hry v134:
  ta používá zatím lokální gameplay logiku, ne nový sdílený bojový server;
- skutečně trvalé serverové ukládání dropů a odměn z boje;
- grafická kvalita, animace a všechna ovládání v134 na mobilních zařízeních;
- nepřetržitá zátěž po hodinách, restart/recovery serveru a chování za
  síťového zpoždění nebo ztracených paketů.

## Co bude potřeba na Oracle

1. Přes SSH stáhnout `multiplayer-dev`, spustit `npm install`, `npm test`.
2. Záloha PostgreSQL a bezpečná aplikace migrací dle
   [ONLINE_POSTAVY_V07.md](ONLINE_POSTAVY_V07.md).
3. Soukromý test účtu a dvou oken arény přes SSH tunel.
4. Změřit CPU/RAM, p95 čas ticku a síťový provoz skutečného ARM stroje
   (1 OCPU, 6 GB RAM). Pro výkonnostní srovnání lze spustit
   `node server/combat-benchmark.mjs`; neměnit mezitím zátěžové parametry.
5. Až pak plánovat veřejné HTTPS, dlouhodobé ukládání stavu a
   integraci společného boje do původních map.

Bod 4 z původního optimalizačního seznamu — předkreslování terénu —
**nebyl realizován**, dle přání zadavatele.
