# Roadmap

1. **Baseline (hotovo):** release v134 oddělen od klientského HTML, CSS, audio a JavaScriptu.
2. **Regression harness:** test načtení hry v reálném prohlížeči, vytváření postavy, savů a 5 pater Akasuzuki.
3. **Submoduly:** data itemů, skills, statistik, bossů a renderování přes deterministické kontrakty.
4. **Shared simulation:** deterministický combat a boss AI bez závislosti na DOM/canvas.
5. **Server:** Node.js server + WebSocket; autoritativní HP, damage, XP, loot.
6. **Coop:** první instance pro 2 hráče, reconnect, souboj s Hydanem, anti-cheat kontroly.
7. **Merge:** novější singleplayer mechaniky přenášet přes testované změny do projektu.

Nejdřív splnit testy parity v každém kroku. Pouhé rozdělení JS na soubory multiplayer nezajistí.
