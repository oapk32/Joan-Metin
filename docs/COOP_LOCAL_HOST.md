# Joan Metin CO-OP – lokální náhled (vizuální kouzla, fáze 1)

Tato oddělená větev **není zatím hotové PvE CO-OP**. Jde o první bezpečný
přechod z původní hry: 2–4 hráči se vidí a pohybují ve stejné oblasti,
každý používá **svou existující singleplayer postavu**.

## Co funguje

- Hru hostuješ na svém Windows počítači (127.0.0.1:3784).
- Každý hráč vidí jména, třídy, pozice a pohyb ostatních v mapě.
- První fáze přenosu vizuálních efektů: gesta při sesílání, vybrané částicové efekty a projektily jiných hráčů. Využívají existující vykreslování v134, ale jsou čistě kosmetické.
- Vizualizace kouzel běží odděleně od kolizí a poškození; zatím není zaručená kompletní věrnost všech kouzel včetně Sage Mode.
- Lokální pohyb není řízen síťovými snapshoty. Ostatní hráči jsou interpolováni.
- V rohu se zobrazuje měření FPS a orientační síťové odezvy.
- Postavy se dál ukládají lokálně v prohlížeči; celý save neopouští počítač.
- CO-OP používá pro renderování 1× pixelový poměr, aby snížil zátěž.
- Původní singleplayer, release, game.js i Oracle multiplayer se nemění.

## Co ještě **nefunguje**

- Společné HP monster, útoky, EXP, bossové, loot, Yang a společné odměny.
- Synchronizace samotného PvE (každý prohlížeč stále simuluje svůj svět).
- Bezpečná migrace inventáře do serverově ověřovaného společného postupu.

Tato verze je **test společné přítomnosti a efektů kouzel, ne hotový CO-OP pro postup**.
Než ji otevřeš, exportuj zálohu všech postav.

## Spuštění na Windows

1. Stáhni tuto větev projektu nebo ji otevři v oddělené složce. Nezasahuj do Oracle.
2. Měj nainstalovaný Node.js 22 nebo novější.
3. Spusť dvojklikem soubor SPUSTIT_COOP.cmd.
4. Skript automaticky otevře hostitelskou hru v prohlížeči a zároveň
   spustí oddělené okno se serverem. To serverové okno nech otevřené.
   Náhodný kód místnosti najdeš i v okně spouštěče. Místnost má limit 4 hráčů.
5. V nabídce Postavy vyber vlastní uloženou postavu.

## Ruční spuštění a aktualizace (Windows Smart App Control)

Pokud Windows blokuje stažený `SPUSTIT_COOP.cmd`, **nevypínej ochranu**.
Rozbal ZIP a otevři PowerShell v normální složce `server`, pak:

    npm.cmd install --no-audit --no-fund
    node .\\coop-host.js

Při aktualizaci ze stejné větve nejdřív zastav server `Ctrl+C`.
Stáhni nové ZIP na https://github.com/oapk32/Joan-Metin/archive/refs/heads/coop-local-host.zip
a rozbal jej se stejnou cílovou cestou, aby se přepsaly soubory v `server`
i `client/js`. Pak znovu spusť `node .\\coop-host.js`. Server vypíše
nový přístupový kód; kamarádovi pošli aktualizovanou adresu tunelu
s novým parametrem `code`. Pokud Chrome použil staré JS, dej `Ctrl+F5`.

## Jak použít staré singleplayer postavy

Singleplayer ukládá data do localStorage na konkrétní doméně a portu.
Jestliže CO-OP běží na jiné adrese, tvoje původní postavy se nezobrazí
automaticky.

- Otevři původní singleplayer, zvol Postavy → Exportovat všechny postavy.
- Otevři novou adresu CO-OP, zvol Postavy → Importovat zálohu.
- Vyber postavu; zálohu JSON nikomu neposílej.
- Před dalším importem exportuj novou zálohu, abys nepřišel o postup.

## Připojení kamarádů přes internet

**Neotvírej veřejně port 3784 v routeru.** Použij Tailscale nebo dočasný
Cloudflare Tunnel spuštěný na **tvém počítači**, kde běží CO-OP host:

    cloudflared tunnel --url http://127.0.0.1:3784

Do odkazu z terminálu místo lokální domény a portu vlož novou HTTPS adresu
Cloudflare. Zachovej celou cestu /coop/?code=... a odkaz sdílej pouze
s důvěryhodnými přáteli. Quick Tunnel má nestálou adresu a negarantuje provoz.

## Testy

Ze složky server:

    npm install
    node --test tests/coop-host.test.js
    npm test

Je nutný ruční test na dvou různých PC. Tento server není ověřený pro
trvalý provoz. Nepřipojuj ho k Oracle betě a nemerguj do hlavní větve.

## Další fáze

Další konkrétní krok: sdílená identita a životní cyklus monster na hostiteli.
Poté společné poškození, exp a loot – **zatím neimplementováno**.

Jedna autoritativní host simulace monster, škálování bojových atributů
z jednotlivých uložených postav, ověřování útoků, spravedlivé rozdělení
serverově vytvořených odměn, verzovaná migrace postav a rollback.
Bez toho by skutečné sdílení inventáře vedlo k duplikacím a rozbitým savům.
