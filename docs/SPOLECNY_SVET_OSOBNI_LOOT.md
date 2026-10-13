# Multiplayerový návrh: společný svět, osobní loot

Tento dokument je pravidlo návrhu hry **Joan Metiny Online**.
Implementujeme jej postupně do větve `multiplayer-dev`.

## Co je společné pro všechny hráče

- Všechna běžná monstra, elity, metiny a bossové mají **jednu společnou
  serverovou existenci**, HP, pohyb, boj, smrt a čas do respawnu.
- Všichni vidí stejné nepřátele a mohou se zapojit do stejného souboje.
- Všechny oblasti a dungeony včetně pater věže a dalších instancí jsou
  **sdílené**; nebudujeme soukromé instance pro jednotlivé hráče nebo skupiny.
- **Neimplementujeme zatím chat ani party.** Společný boj nevyžaduje skupinu.
- Postavy mají vlastní HP, schopnosti, vybavení, inventář a postup.

## Osobní loot / odměny

1. Server vyhodnotí smrt společného monstra **jednou**.
2. Zjistí, kteří hráči splnili podmínky účasti na zabití (v aréně zatím
   alespoň jeden skutečně udělený zásah v posledních 10 sekundách).
3. Pro **každého oprávněného hráče zvlášť** provede dropové hody. Nejde
   o jeden předmět rozdělovaný mezi všechny; výsledek každého hráče může
   být jiný. Šance jsou nezávislé.
4. Drop vytvoří **jen pro jeho vlastníka**. Ostatní hráči tento předmět
   nevidí ve svém síťovém snapshotu a nemohou ho sebrat ani podvrhnutým ID.
5. EXP/Yangy se přidělují odděleně oprávněným hráčům. Nemáme skupinový
   loot ani party loot pravidla.
6. Až vznikne plný serverový inventář, teprve tehdy lze položky skutečně
   a bezpečně uložit do PostgreSQL. Prohlížeč nesmí rozhodovat o dropu.

### Testovací aréna v0.8

- Sdílené dva vlky a orka má jedna testovací místnost.
- Osobní testovací kořist se zobrazuje na zemi pouze vlastníkovi,
  sebrání `E`, tlačítkem **Sebrat** nebo kliknutím.
- Server ověřuje vlastníka, dosah 65 jednotek, život postavy,
  kapacitu testovacího batohu (30) a platnost kořisti.
- Kořist po 30 sekundách zmizí; nepřežitá kořist zmizí i při odpojení.
- Při smrti vlka se každému oprávněnému hráči samostatně hází
  50 % na testovací vlčí kožešinu, u orka 60 % na testovací trofej.
  **Jde jen o dočasné údaje testovací arény, nikoli drop tabulky v134.**
- Testovací předměty, EXP a Yangy se **neukládají do databáze**.
  Po restartu Node.js procesu nebo odpojení se ztratí.
- Server oběma hráčům pošle stejný stav monster, ale každému
  **jiný, jen jeho vlastní seznam osobní kořisti**.

## Co není ještě hotovo

- Sdílené instance napříč původními šesti zeměmi, včetně Věže démonů
- Skutečné dropové tabulky v134, rarity, bonusy a inventář
- Serverem potvrzené získání a trvalé uložení skutečných předmětů
- Finální pravidla minimálního příspěvku, protizneužití a odměňování bossů

Tyto body se musí dokončit a otestovat před veřejným multiplayerem.
Nyní jde jen o architekturu a ověřený test v samostatné aréně.

## Ověření

Testy `server/tests/combat-world.test.js` a
`server/tests/combat-ws.test.js` ověřují nezávislé hody, soukromý
snapshot, nemožnost sebrat cizí loot, expiraci a bezpečné zacházení s
klientskými zprávami.
