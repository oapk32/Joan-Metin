# Joan Metin CO-OP – lokální náhled

Tato oddělená větev **není zatím hotové PvE CO-OP**. Jde o první bezpečný
přechod z původní hry: 2–4 hráči se vidí a pohybují ve stejné oblasti,
každý používá **svou existující singleplayer postavu**.

## Co funguje

- Hru hostuješ na svém Windows počítači (127.0.0.1:3784).
- Každý hráč vidí jména, třídy, pozice a pohyb ostatních v mapě.
- Lokální pohyb není řízen síťovými snapshoty. Ostatní hráči jsou interpolováni.
- V rohu se zobrazuje měření FPS a orientační síťové odezvy.
- Postavy se dál ukládají lokálně v prohlížeči; celý save neopouští počítač.
- CO-OP používá pro renderování 1× pixelový poměr, aby snížil zátěž.
- Původní singleplayer, release, game.js i Oracle multiplayer se nemění.

## Co ještě **nefunguje**

- Společné HP monster, útoky, EXP, bossové, loot, Yang a společné odměny.
- Synchronizace samotného PvE (každý prohlížeč stále simuluje svůj svět).
- Bezpečná migrace inventáře do serverově ověřovaného společného postupu.

Tato první verze je **test společné přítomnosti, ne hotový CO-OP pro postup**.
Než ji otevřeš, exportuj zálohu všech postav.

## Spuštění na Windows

1. Stáhni tuto větev projektu nebo ji otevři v oddělené složce. Nezasahuj do Oracle.
2. Měj nainstalovaný Node.js 22 nebo novější.
3. Spusť dvojklikem soubor SPUSTIT_COOP.cmd.
4. Skript automaticky otevře hostitelskou hru v prohlížeči a zároveň
   spustí oddělené okno se serverem. To serverové okno nech otevřené.
   Náhodný kód místnosti najdeš i v okně spouštěče. Místnost má limit 4 hráčů.
5. V nabídce Postavy vyber vlastní uloženou postavu.

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

Jedna autoritativní host simulace monster, škálování bojových atributů
z jednotlivých uložených postav, ověřování útoků, spravedlivé rozdělení
serverově vytvořených odměn, verzovaná migrace postav a rollback.
Bez toho by skutečné sdílení inventáře vedlo k duplikacím a rozbitým savům.
