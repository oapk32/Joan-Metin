# Jak spustit Joan Online a hrát s kamarády

## Jeden počítač (nejjednodušší)
1. Nejprve vypni staré okno serveru kombinací Ctrl+C.
2. Dvojklik na soubor `SPUSTIT_JOAN.cmd` v hlavní složce projektu.
3. V prohlížeči se otevře `http://127.0.0.1:3000/joan/`.
4. Testuj dvě postavy v normálním a anonymním okně Chrome.

## Připojení kamarádů mimo tvoji domácnost: Tailscale Serve
Aktuální prototyp není veřejně zabezpečený. Pro test s **důvěryhodnými kamarády** použij soukromou Tailscale síť. Neotvírej port 3000 na routeru a nepoužívej veřejný `tailscale funnel`.

1. Na svůj počítač nainstaluj Tailscale z <https://tailscale.com/download/windows>, přihlas se.
2. Přidej přátele do svého tailnetu pouze tehdy, pokud jim důvěřuješ, a zkontroluj přístupová oprávnění. Každý musí mít Tailscale a přístup do stejné sítě.
3. Spusť `SPUSTIT_JOAN.cmd` a ověř, že lokální hra funguje.
4. V PowerShellu zadej:
   ```powershell
   tailscale serve --bg 3000
   tailscale serve status
   ```
5. Tailscale zobrazí privátní HTTPS adresu, například `https://nazev-pc.nazev-site.ts.net/`. **Skutečnou adresu vezmi z výstupu, nevymýšlej ji.**
6. Kamarádi v tvé Tailscale síti otevřou **zobrazenou HTTPS adresu s `/joan/` na konci**.
7. Pro vypnutí sdílení:
   ```powershell
   tailscale serve --https=443 off
   ```
   Pokud tvoje verze používá jiné volby, postupuj podle `tailscale serve --help` a oficiální dokumentace.

Tailscale Serve umožňuje sdílet lokální webový server **jen uvnitř soukromého tailnetu** a používá HTTPS. Pokud po prvním spuštění vyžádá aktivaci HTTPS certifikátů, dokonči průvodce.

Důležité: bez přihlášení ve hře mohou testující předstírat jakékoliv jméno a pozici. Sdílené bojové odměny a účty proto ještě nejsou aktivní. Tento prototyp není připravený na otevřený veřejný internet.

## Později: veřejný server pro 10–30 hráčů
Po dokončení přihlašování, serverem řízeného boje, ukládání a bezpečnostních testů použij veřejnou VM (např. Oracle Cloud) s HTTPS/WSS, doménou, firewallem a zálohami. Veřejný port 3000 dnes neotvírej.

## Co je hotové / rozpracované
- ✅ Postavy v původní mapě v134, přenos jména, povolání a směru
- ✅ Plynulejší interpolace pozic, modely postav s animací chůze
- ✅ Start serveru dvojklikem a aktualizace dvojklikem
- ⏳ Sdílená AI, boj, EXP, loot, party, účty a PostgreSQL: teprve vývoj
