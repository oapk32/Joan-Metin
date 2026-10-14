# Integrace původní v134 do autoritativního multiplayeru

Stav: **technický plán**, ne hotová integrace. Aktuální herní server na Oracle běží stále z nasazeného commitu `c839139` a nesmí se zaměňovat s novými commity na GitHubu.

## Co bylo ověřeno při první soukromé betě

Dva účty a dvě online postavy současně hrají testovací arénu na Oracle. Hráči se vidí a oba pozorují stejnou změnu HP při útoku na vlka. PostgreSQL má migrace 001–003. Postup arény (EXP/Yang/loot) je pouze dočasný.

## Aktuální oddělení systémů

- `/joan/` spouští původní v134. `client/js/game.js` nadále řeší mapy, místní boj, statistiky, inventář, dropy a ukládání v prohlížeči.
- `client/js/mp-bridge.js` + `/joan-ws` jsou **pouze přítomnost jiných postav**; zprávy `joan-state` obsahují klientem dodané souřadnice. Nesmí rozhodovat o útocích, vzdálenosti, HP, kořisti ani změně mapy.
- `server/combat-ws.js` + `server/combat-world.js` jsou autoritativní, vázané na postavu vlastněnou přihlášeným účtem. Server počítá pohyb, útok, zásah, smrt/respawn a osobní loot, ale zatím **jen v testovací aréně**.
- `server/combat-interest.js` filtruje pozorovatelné entity podle mapy a vzdálenosti; `combat-snapshot` + `combat-delta` posílají změny okolí.
- v134 grafiku ani vykreslování terénu nepředělávat. Nepřidávat chat/party ani soukromé instance. Veškeré moby, metiny, bossy i dungeony musí sdílet jeden stav.

## Pořadí implementace

### Etapa 1 – Jednoznačná identita online postavy a mapy

1. Vybrat online postavu z `/account/` podle jejího skutečného `id`; server ji ověří vůči session.
2. Propojit identifikátory původních oblastí v134 s interním `mapId` na serveru **podle skutečných dat v134**, ne podle odhadu. Vytvořit a otestovat mapový registr.
3. Definovat pouze serverem povolený vstup do mapy, spawn bod a přechody. Klientský údaj `room` z `joan-state` se nepovažuje za autoritu.
4. Při odpojení/reconnectu nesmí jiný účet převzít postavu; dvě současná spojení téže postavy se bezpečně odmítnou.

### Etapa 2 – Původní kreslení, ale serverové entity

1. Použít stávající canvas v134 k vykreslení stavů hráčů/mobů získaných ze serveru. Od začátku oddělit staré lokální moby od serverových, aby se nezobrazovaly dvakrát.
2. `combat-snapshot` inicializuje pouze aktuální okolí, `combat-delta` aplikuje změny; odchod z mapy a z AOI správně odstraní vzdálené entity.
3. Pohyb klient pouze **požaduje** (směr/tlačítka). Server kontroluje rychlost, kolize a mapové hranice, a následně publikuje opravené souřadnice.
4. Přednost mají vizuální testy skutečné v134 se dvěma oddělenými prohlížeči, ne jen syntaktická kontrola.

### Etapa 3 – Autoritativní původní PvE

1. Převést definice a spawny skutečných v134 monster do serverové konfigurace, včetně HP/útoku/rychlosti. Zachovat jednotný společný stav a absolutní respawn timer.
2. Útok a schopnosti posílat jako záměr: server ověřuje výbavu, cooldown, dosah, živý cíl, zdroje, zásah a poškození. Nikdy nepřijímat klientem vypočítané HP, EXP ani položky.
3. Serverová AI skenuje cíle nanejvýš 1×/s na mob, prázdné mapy uspává bez resetu stavu; AOI odesílá jen blízké změny.
4. Dva hráči útočí na stejného vlka přímo na původní mapě; oba musí vidět stejné HP, smrt a respawn.

### Etapa 4 – Trvalé účty, loot a další mapy

1. Přenést všechny původní drop tabulky v134; každému oprávněnému přispěvateli samostatně losovat loot. Vlastní předměty zůstanou **na zemi 120 s**, bez pevného globálního limitu kusů. Cizí loot nelze číst ani sebrat.
2. Přidat serverový inventář, výbavu, EXP/Yang a bezpečné transakční ukládání do PostgreSQL. Staré browserové save nesmí přepisovat online stav.
3. Pokrýt všechny mapy, metiny, bossy a věž démonů jako sdílené lokace; bez soukromých instancí.
4. Až po dokončení inventáře přidat administrátorské databázové funkce pro předměty; **žádný veřejný import/export** postav do multiplayeru.

## Bezpečnostní pravidla před každým nasazením

- Všechny změny nejdřív na `multiplayer-dev`, `main` (singleplayer) beze změny.
- GitHub CI: Node testy, skutečné PostgreSQL 16 migrace, test dva browsery, sektorový AOI, soukromé dropy a simulovaný benchmark.
- Po integraci v134 doplnit browser e2e pro **originální mapu v134**, vstup přes online účet, dvě postavy a jeden společný vlk.
- Oracle nasazovat jen ručně po testech a záloze. Zachovat možnost návratu Node kódu; nikdy automaticky nevracet DB migrace.
- Nepřipravovat předkreslování terénu a nepřepisovat existující grafiku bez důvodu.

## Kritérium dokončení první reálné herní mapy

Dva hráči přihlášení na svých účtech vstoupí na skutečnou v134 mapu, vidí původní grafiku i navzájem se správným serverovým pohybem, bojují s **týmž** serverovým vlkem, sledují totožné HP/smrt/respawn a nezískají odměnu úpravou browserového stavu. Teprve potom lze říct, že první mapa v134 skutečně funguje online.
