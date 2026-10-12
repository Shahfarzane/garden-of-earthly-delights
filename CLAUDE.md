# CLAUDE.md

Web app (live at https://mirage.nerd.ceo, public repo https://github.com/Shahfarzane/garden-of-earthly-delights) that repaints Bosch's "The Garden of Earthly Delights" with JavaScript brush strokes. Read `README.md` for architecture and the regeneration pipeline, `docs/plan.md` for decisions.

## Hard rule

Nothing on screen may be a decoded photograph of the painting. The scans feed only the offline analyzer (`tools/`), which emits stroke data; the browser paints strokes, procedural effects, Canvas2D creatures and synthesized audio.

## Reference sources

- Tile scans (pixel source of truth): `tiles/tile-x{0..5}-y{0..2}.jpg` (gitignored) or the folder in `BOSCH_TILES`; on Shahin's Mac they are in `/Users/shahin/Downloads/Original tiles`; upstream https://commons.wikimedia.org/wiki/Template:Tile_set/The_Garden_of_Earthly_Delights/grid
- 18,000 px copies for eyeballing: `Bosch - The Garden of Earthly Delights/` in this folder (gitignored); upstream https://commons.wikimedia.org/wiki/File:The_Garden_of_earthly_delights.jpg
- Story positions and sound zones: `data/places.json`, coordinates only, extracted once from the Bosch POI file Shahin supplied (that file and its museum texts are deliberately not in the repo or its history; never add them). Story titles and texts are original writing in `data/stories.json`. `tools/buildScene.js` joins the two into `public/data/scene.json`.
- Hosting: https://mirage.nerd.ceo, a static Cloudflare Worker (`cloudflare.config.ts`), deployed with `npm run deploy` (the `cf` CLI).

## Design reference

- UI colours, text sizes and edges follow Klim Type Foundry's site, https://klim.co.nz (Shahin's pick, 2026-10-12). Values were read from its live computed CSS and are recorded as tokens at the top of `src/style.css`: black `#000` ground, `#1c1c1c` panels, text ramp `#fff` / `#c6c6c6` / `#8d8d8d` / `#555`, 14/21 px body, scale 14/16/18/24/36/48, 1px `#383838` rules, 2px corners, no shadows or blur.
- Fonts: Die Grotesk (text) and Martina Plantijn (headings) by Klim, in `fonts/` (untracked, licensed: the site ships them under Shahin's web licence, the public repo must not).

## Invariants

- `src/shared/strokeModel.js` (CPU) and `STROKE_FS` in `src/engine/shaders.js` (GPU) must stay in lockstep; the analyzer relies on simulating exactly what the browser paints.
- World units are source-scan pixels (156,547 x 89,116). Level z has scale 2^(z-9); tiles are 256 px.
- `public/data/strokes/`, `public/data/exterior/` and `work/` are generated and gitignored.
- The repo is public (MIT for the code). Keep personal paths, the museum texts, the fonts and the scans out of it.
