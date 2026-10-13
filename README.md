# Joan Metiny — Release 1.0 / Multiplayer development

Základ hry: **Joan: Stíny metinů v134 = Release 1.0**.

## Vývojové větve
- `main` — stabilní singleplayer a obsahové/balanční aktualizace.
- `multiplayer-dev` — modulární architektura, síťový server, společný svět.

## Důležité: probíhá import hry
První commit založil pouze tento README. **Kompletní kód ještě není na GitHubu.** Zdrojovým balíčkem je `joan_project_1_0.zip` z ChatGPT, jehož rozbalený obsah (vyjma vložené složky `.git`) se má importovat do kořene tohoto repozitáře.

Očekávaná struktura po importu:

```text
release/joan_metiny_2d_v134.html  # neměnný single-file release
client/index.html                  # webový klient
client/css/game.css
client/js/audio-data.js
client/js/game.js
scripts/verify.py
docs/ROADMAP.md
```

`client/js/game.js` je zatím monolitická herní logika, ne skutečný multiplayer ani hotová modularizace.

Po importu kontrolovat `python scripts/verify.py` (vyžaduje Node.js) a spouštět klienta lokálním HTTP serverem v adresáři `client` (`python -m http.server 8000`).

**Nesdílet hesla, access tokeny ani skutečné herní savy v repozitáři.**
