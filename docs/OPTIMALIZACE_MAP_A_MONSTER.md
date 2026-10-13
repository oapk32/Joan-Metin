# Optimalizace map a monster – Joan Metiny Online

Tento plán vychází z aktuální větve `multiplayer-dev`, testovací PvE arény
a skutečné struktury klienta v134. Není to tvrzení, že je už hotový celý
síťový herní svět.

## Hotovo v testovací aréně

- Kompletní přehled nejbližšího hráče hledá každé monstrum **nejvýše jednou
  za 1000 ms**. Při úderu od hráče se konkrétní zasažené monstrum probudí
  přímo, bez prohledávání všech hráčů.
- Mezi těmito kontrolami se aktivní monstra dále pohybují, útočí a ověřují
  dosah aktuálního cíle na 20Hz ticku.
- Spící monstrum na výchozí pozici vynechá výpočty AI a pohybu až do další
  pravidelné kontroly. V úplně prázdné testovací aréně se monster-AI přeskočí.
  Respawn zůstává určen časem; při příchodu hráče se zkontroluje.
- `createCombatWorld().diagnostics()` vrací počet plných scanů, celkový
  počet monster a počet monster spících na spawnu. Test s 200 monstry
  ověřuje, že spící monstra prohledávají hráče jen jednou za sekundu.
- Soukromý loot se uklízí cca jednou za sekundu, má životnost 120 sekund,
  bez pevného limitu počtu předmětů. Server soukromý seznam posílá pouze
  při změně, ne při každém pohybovém snapshotu.
- Herní JavaScript a CSS už nepoužívají HTTP `no-store`: server posílá
  soukromé ETagy s revalidací, a pro nezměněná data vrací `304 Not Modified`.
  Přihlášení a HTML stále mají `no-store` a chrání je session.

**Důležité:** Žádná z těchto změn zatím automaticky nenasazuje
nový multiplayer na Oracle. Nejdřív aktualizovat kód a testy.

## Co ukázala kontrola souborů v134

Ve veřejném GitHub repozitáři:
- `client/js/game.js`: přibližně **1,43 MB**;
- `client/js/audio-data.js`: přibližně **7,23 MB**;
- `client/index.html` načítá `audio-data.js`, `mp-bridge.js` a `game.js`
  přímo při otevření hry.

ETag usnadní **další** načtení. První načtení stále přenáší velké soubory.
Odkládat načtení zvuků / rozdělit audio do samostatných souborů má potenciál
větší úspory, ale vyžaduje audit vazeb v `game.js` a zachování offline režimu
původní v134. Nedělat to slepou náhradou.

## Doporučené další kroky v pořadí

1. **Sektory map a zájem hráče (AOI)**. Rozdělit každou sdílenou mapu na
   buňky. Pro daného hráče posílat hlavně objekty okolních buněk,
   nikoliv všech 36 herních oblastí. Při překročení hranice zaslat změny
   sektoru. Společné HP/bossové zůstávají jedinou serverovou pravdou.
2. **Mapové spánkové režimy**. Pokud na dané mapě není hráč ani probíhající
   důležitá událost, nepočítat jednotlivá monstra 20×/s. Přitom zachovat
   absolutní čas respawnů a stav společných bossů; probudit mapu bezpečně
   při vstupu hráče, aby nevznikaly resetované instance.
3. **Rozložit zatížení AI v čase**. Nehledat cíle tisíců monster ve stejném
   ticku. Střídat jejich 1Hz kontroly mezi jednotlivými snímky.
4. **Prostorový index**. Při 30 hráčích / stovkách monster hledat cíle jen
   ve vlastním a sousedních sektorech, nikoliv mezi všemi online postavami.
5. **Vrstvy map na klientovi**. Předkreslit statické podklady a dekorace
   do mezipaměti canvasu; přerenderovat je jen při změně mapy/kamery.
   Dynamicky kreslit pouze viditelná monstra, hráče, efekty a loot.
6. **Lazy loading**. Zvuková data načíst až při potřebě; velké grafické
   nebo datové části map načítat jen pro aktuální oblast a nejbližší přechod.
   Nejprve ověřit, zda současné funkce v134 nezávisí na synchronním načtení.
7. **Událostní síťové zprávy**. Spawn, smrt, změna HP, sebrání předmětu a
   odchod ze sektoru jako změny; neustále posílat jen potřebné pohyby.
8. **Měření**. Před a po optimalizaci měřit dobu ticku (p50/p95/p99),
   počet aktivních a spících monster, WebSocket bajty/sekundu, spotřebu
   CPU/RAM na VM a časy načtení prvního/dalšího otevření. Nenastavovat
   pevný limit lootu jako náhradu za optimalizaci přenosu.

## Herní kompromisy

Hledání nového cíle jednou za sekundu znamená, že příchozí hráč může
být detekován až za ~1 s (pokud monstrum už není v boji).
Úder hráče může konkrétní monstrum probudit ihned, ale samotné útoky
monstra stále dodržují cooldown. Pokud bude reakce bossů působit pomalu,
dává smysl pro bosse později jiné AI nastavení než pro běžné moby.

Nedoporučujeme uspávat nebo resetovat právě probíhající boss fight,
i když se hráči od bosse na chvíli vzdálí. Sdílené instance
nezískají soukromé kopie jen kvůli optimalizaci.

**Nezavádíme chat ani party. Loot na zemi zůstává osobní a mizí po 120 s.**
