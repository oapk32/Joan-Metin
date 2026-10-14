# První oblast v134 na serveru – Okraj Joanu 1–2

**Stav:** vývojový serverový prototyp na větvi `multiplayer-dev`. **Nejde ještě o kompletní propojení grafiky nebo boje původního klienta v134.** Běžící Oracle beta se sama z GitHubu neaktualizuje.

## Co je skutečně hotové

- Podle originální `ROOM[1]` a `TYPES` ve v134 vznikla na serveru jedna sdílená oblast `joan-1-2` s **5 toulavými psy a 5 vlky**. Definice jsou v `server/v134-first-map.js`.
- Výchozí místo hráče je `140,330`, rozměry `1100×660` odpovídají canvasu v134. Spawny monster jsou nyní **pevné testovací pozice**, nikoli ještě převzaté původní náhodné pozicování. Základní HP/útok/EXP jsou zaokrouhlené hodnoty původních typů a balancu; serverový útok hráče je stále zkušební.
- Jediný autoritativní serverový stav monster na mapě; změny HP, úmrtí, AI (1Hz hledání hráčů) a respawn vidí připojení hráči společně.
- Zprávy `/v134-ws?character=<id>` vyžadují session a ověření **vlastnictví online postavy**; klient neposílá pozici, HP, damage ani odměny, pouze pohybový směr a požadavek na útok.
- `/combat-ws` pro původní zelenou arénu zůstává oddělené, včetně původních tří monster. Server drží sdílenou rezervaci přihlášených postav: **jedna online postava nemůže zároveň hrát v obou oblastech**. Celkem nejvýše 30 současně aktivních postav v těchto dvou serverových testovacích světech.
- AOI sektory po 220 jednotkách / dohled 440; pouze okolní mobové/hráči, zprávy se změnami; osobní testovací loot není v paketech ostatních hráčů. Osobní loot na zemi expiruje po 120 s; bez pevného limitu počtu položek.
- Reálná dvouhráčová aréna i první mapa jsou ve vyhrazeném Node procesu. Účty/postavy v PostgreSQL, **boj, inventář, EXP, Yangy a loot testovací mapy jen v RAM**.

## Jak mapu otevřít po budoucím schváleném nasazení

Na `/account/` vyber u vlastní online postavy odkaz **„Test mapy 1–2 (zatím bez grafiky v134)”**. Otevře se `/arena/?character=<id>&region=joan-1-2` s testovacím zobrazením nové společné oblasti. Ovladatelnost WASD, mezerník, E zůstává jako v aréně. Testovací zobrazení **záměrně zůstává jednoduché**: ještě nevolá renderovací funkce v134. Uživatel nemá dojem, že už byl dokončen převod grafiky originálu.

## Automatické testy

- `server/tests/v134-first-map.test.js`: původní počty typů, hranice mapy, AOI, sdílené HP, respawn, osobní loot, nemožnost podvrhnout nepovolenou mapu, autorizované WebSocket spojení.
- `server/tests/v134-world-occupancy.test.js`: jedna postava může být vždy jen v jedné testovací lokaci; po odpojení se může bezpečně přepojit.
- `server/browser-smoke.mjs`: dva skutečné profily Chromium, přihlášení a hraní původní arény, následně vstup do stejné serverové oblasti 1–2 přes rozhraní účtu. Testované prohlížeče běží v CI proti dočasnému PostgreSQL, **ne proti Oracle**.

## Co je stále nutné pro hraní přímo ve v134

1. Spojit autentizovanou online postavu s původním vizuálním hrdinou v `/joan/`; oddělit lokální uložené postavy od serverových dat.
2. Použít existující v134 kreslení `v38DrawMob`/postav/terénu pro serverové moby a další hráče, aniž by se znovu spouštěla lokální AI či klientský výpočet poškození.
3. Připojit animaci útoku jako klientský **požadavek**, validovat na serveru cooldown a dosah, zpracovat skutečnou výbavu/dovednosti a účinné bojové modifikátory.
4. Zabránit lokálním save/export funkčním cestám zapisovat online inventář a EXP. Všechny trvalé odměny až po implementaci transakčního serverového inventáře.
5. Potom postupně přidat metiny, další mapy, bossy a společné dungeony; zachovat originální grafiku beze změny a **nepředkreslovat terén**.

Zelenou arénu není možné prostě nazvat v134 multiplayerem. Tento commit je dokončením **serverové první mapy**, nikoliv celé klientské integrace.
