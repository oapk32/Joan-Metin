# Joan Metiny — multiplayer proof of concept

Tato složka je **oddělený lokální test**, ne multiplayerová verze původního klienta v134.

## Windows: spuštění
1. Nainstaluj Node.js LTS.
2. V kořeni naklonovaného repozitáře spusť:
   ```powershell
   cd server
   npm.cmd install
   npm.cmd start
   ```
3. Otevři `http://127.0.0.1:3000` ve dvou záložkách/oknech. Pohyb WASD/šipky; jinak obě okna zobrazují stejné pozice.
4. Ukončení: **Ctrl+C** v PowerShellu.

Server naslouchá pouze na `127.0.0.1`, takže je zatím dostupný jen na daném PC. **Neotevírej port 3000 do internetu.**

## Co už funguje
- WebSocket spojení klient–server a přidělené ID
- Limit 30 připojení
- Serverem řízený pohyb na testovací ploše a synchronizace 20× za sekundu
- Odpojení hráčů

## Co zatím nefunguje
- Připojení skutečného renderingu a herních systémů v134
- Databáze PostgreSQL, účty, zabezpečené přihlášení
- Boj, monstra, inventář, party, dungeon instance
- Veřejný hosting, TLS, monitoring

Další krok: oddělit synchronizaci pohybu z prototypu a propojit se skutečným Canvas klientem v134.
