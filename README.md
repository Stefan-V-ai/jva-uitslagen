# Uitslagen RC Jan van Arckel

Telefoon-app met de jeugduitslagen en klassementen van RC Jan van Arckel (veldrijden 2026/2027, MTB LJC 2026).
Alle gegevens komen uitsluitend van de KNWU (mijn.knwu.nl, via de publieke databron die die site zelf gebruikt).

- `index.html` – de app (gebouwd, niet met de hand aanpassen)
- `src/template.html` – de app zonder data
- `data.json` – alle uitslagen en klassementen
- `scripts/core.js` – ophalen en verwerken van de KNWU-data
- `scripts/update.mjs` – dagelijkse update, `scripts/build.mjs` – bouwt `index.html`
- `.github/workflows/update.yml` – draait elke avond om 18:00 (Nederlandse tijd) en zet de site online

Handmatig bijwerken: tabblad **Actions** → **Uitslagen bijwerken** → **Run workflow**.
