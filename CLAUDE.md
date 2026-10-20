# CLAUDE.md

Web app (live at https://mirage.nerd.ceo/garden/, public repo https://github.com/Shahfarzane/garden-of-earthly-delights) that repaints Bosch's "The Garden of Earthly Delights" with JavaScript brush strokes. Read `README.md` for architecture and the regeneration pipeline, `docs/plan.md` for decisions.

## Hard rule

Nothing on screen may be a decoded photograph of the painting. The scans feed only the offline analyzer (`tools/`), which emits stroke data; the browser paints strokes, procedural effects, Canvas2D creatures and synthesized audio.

## Reference sources

- Tile scans (pixel source of truth): `tiles/tile-x{0..5}-y{0..2}.jpg` (gitignored) or the folder in `BOSCH_TILES`; on Shahin's Mac they are in `/Users/shahin/Downloads/Original tiles`; upstream https://commons.wikimedia.org/wiki/Template:Tile_set/The_Garden_of_Earthly_Delights/grid
- 18,000 px copies for eyeballing: `Bosch - The Garden of Earthly Delights/` in this folder (gitignored); upstream https://commons.wikimedia.org/wiki/File:The_Garden_of_earthly_delights.jpg
- Story positions and sound zones: `data/places.json`, coordinates only, extracted once from the Bosch POI file Shahin supplied (that file and its museum texts are deliberately not in the repo or its history; never add them). Story titles and texts are original writing in `data/stories.json`. `tools/buildScene.js` joins the two into `public/data/scene.json`.
- Hosting: https://mirage.nerd.ceo/garden/, the static Cloudflare Worker `garden` on routes for that path (`cloudflare.config.ts`), deployed with `npm run deploy` (the `cf` CLI). Mirage's own Worker holds the domain's root. The address lives in `site.config.js` only; the app reads it back as `import.meta.env.BASE_URL`.

## Design reference

- The interface follows Mirage, Shahin's site for every painting he repaints (klim-paintings, a private repository), whose layout is taken from Klim Type Foundry's family pages (Shahin's call, 2026-10-20). Its tokens are copied with file and line citations at the top of `src/style.css`: black ground, colour mixes `#e2e2e2` to `#1c1c1c`, type 14/16/18/24/36/48 stepping down per breakpoint, spacing over a 1680/768/430 basis, 12/6 columns, 10px gutter, 20/10px margins, 28px lozenges 5px apart, 2px corners. Values were checked against its running dev server; check again there before changing them.
- Fonts: Söhne by Klim (Buch, Kursiv, Halbfett, Mono, Ikon), as Mirage, in `fonts/` (untracked and licensed: Shahin handles the licence, and the public repo must not contain them).

## Invariants

- `src/shared/strokeModel.js` (CPU) and `STROKE_FS` in `src/engine/shaders.js` (GPU) must stay in lockstep; the analyzer relies on simulating exactly what the browser paints.
- World units are source-scan pixels (156,547 x 89,116). Level z has scale 2^(z-9); tiles are 256 px.
- `public/data/strokes/`, `public/data/exterior/` and `work/` are generated and gitignored.
- The repo is public (MIT for the code). Keep personal paths, the museum texts, the fonts and the scans out of it.
