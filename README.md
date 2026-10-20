# Mirage: The Garden of Earthly Delights, painted live

Hieronymus Bosch's triptych, repainted stroke by stroke in your browser on an endless dark board. Live at https://mirage.nerd.ceo.

No photograph of the painting is shipped or displayed. An offline analyzer studied the Prado's 156,547 x 89,116 px scan like a copyist and wrote 57.9 million brush strokes (15.4 million for the whole painting, 42.4 million more of deep detail around the 46 story points, plus 113,570 for the closed shutters). The browser paints every one of them with WebGL2, then brings the scene to life with water, fire, light, moving figures, creatures and synthesized sound.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5317.

The stroke data (about 690 MB) is generated, not committed. A fresh clone shows the board, the frames and the UI but no paint until you run the pipeline in [Regenerate the data](#regenerate-the-data), which needs the 2 GB tile scans.

Controls: two-finger scroll or drag to pan, pinch (or Ctrl/Cmd + scroll, or the mouse wheel) to zoom, double-click to zoom in (Shift to zoom out), arrow keys or WASD to pan, `+`/`-` to zoom, `0` for the whole triptych, Esc to close a story or panel, hold `L` to sweep a raking lamp over the varnish. Top right: Exterior closes or opens the wings, Strokes shows the counts and a mode that paints every stroke in its own colour, Sound picks off, nature or period music, and the menu holds story markers, living painting, varnish and cracks, and full screen. Zoom and the whole painting are bottom right. The interface follows Mirage, Shahin's site for every painting he repaints with code; the breadcrumb leads back to it.

Fonts: the site uses Die Grotesk (text) and Martina Plantijn (headings) by Klim Type Foundry, under a web licence. They are not in this repo; without a `fonts/` folder the UI falls back to system fonts.

## How it works

| layer | where | what |
| --- | --- | --- |
| Analyzer | `tools/` | Decodes the Prado tile scans with JPEG shrink-on-load, removes craquelure, then paints each 256 px tile of a level pyramid with layered arc-shaped strokes where a simulated copy still differs from the original. `src/shared/strokeModel.js` is shared with the browser so the simulation matches the GPU pixel for pixel. |
| Painter | `src/engine/` | Tile atlas painted by instanced GLSL strokes (`shaders.js`), progressive paint-in, camera with inertia and van Wijk flights, post pass for water, fire, foliage, sky, lightning, craquelure, frames and hinges (`post.js`). |
| Living layer | `src/living/`, `src/life/` | Canvas2D creatures and particles placed where Bosch painted them: the flock from Eden's rock, the Fountain of Life's jets, leaping fish, bubbles, the cavalcade's dust, Hell's smoke, embers, searchlights, bats. |
| Living figures | `src/living/animator.js`, `src/living/rigs.js` | Rigs that make figures move: rotate, translate and scale warps of the painted image in the post shader, plus eyes that follow the pointer and blink, splashes and glows drawn on the overlay. |
| Sound | `src/audio/` | Web Audio synthesis only, no audio files. Two modes: nature (wind, water, birds, fire, crowds, thunder placed on 105 sound zones, no music) and period (the same plus a generated lute, recorder and viol consort per panel, with the melody written on a sinner's buttocks, read from the full-resolution scan, as Hell's cantus firmus). |
| Exterior | `src/ui/shutters.js`, `src/engine/exteriorPainter.js` | Closing the wings swings the shutters shut over the centre panel; their faces carry the grisaille "Creation of the World" painted from its own stroke data at twice the photo's resolution, inside procedural frames. |
| Stories | `src/ui/`, `data/places.json`, `data/stories.json` | 46 story points as quiet markers that appear once you are close enough. `data/places.json` holds where each story and sound zone sits; `data/stories.json` holds the titles and texts, written for this project. `node tools/buildScene.js` joins them into `public/data/scene.json`. |

## Regenerate the data

Sources (not in git):

- The 18 tiles of the Prado scan, from https://commons.wikimedia.org/wiki/Template:Tile_set/The_Garden_of_Earthly_Delights/grid. Save them as `tiles/tile-x{0..5}-y{0..2}.jpg` (x is the column, y the row), or point `BOSCH_TILES` at the folder that holds them.
- For the closed exterior, the photo https://commons.wikimedia.org/wiki/File:El_Bosco_-_Tr%C3%ADptico_del_Jard%C3%ADn_de_las_delicias.jpg (1806 x 1920, sha1 ac1a5f789ae2e611b5dcdaece5a4ceff2b2b5caa), anywhere outside the repo.

```bash
node --max-old-space-size=8192 tools/prepare.js
```

```bash
node tools/paint.js --levels 0-6
```

```bash
node --max-old-space-size=8192 tools/prepareDeep.js
```

```bash
node tools/paint.js --levels 7-8 --deep work/deep-plan.json --workers 3 --resume
```

```bash
node tools/effects.js
```

```bash
WORLD=exterior node tools/prepareExterior.js /path/to/El_Bosco_-_Triptico_del_Jardin_de_las_delicias.jpg
```

```bash
WORLD=exterior node tools/paint.js --levels 0-3
```

`--workers` trades speed for heat (all cores by default); `--resume` skips tiles already written. `node tools/manifest.js` refreshes the list of deep tiles the browser may request and writes `stats.json`, the exact counts shown in the strokes panel. `node tools/simPreview.js 6 x0 y0 x1 y1 out.png` (with `--sim` passed to `paint.js`) writes the analyzer's simulated copy next to the original for any region.

Timing on an M1 Pro: `prepare` about 2 minutes, levels 0 to 6 about 15 minutes, the deep hotspot levels roughly an hour at full speed (z8 alone took 32 minutes). Stroke data totals about 690 MB (185 MB for levels 0 to 6, 505 MB for the deep hotspots). Without the exterior step the wings control has nothing to show on the shutters.

## Deploy

The site is a static Cloudflare Worker, configured in `cloudflare.config.ts` (custom domain included, so Cloudflare manages the DNS record; change `domains` in a fork). `vite build` writes Cloudflare's Build Output into `.cloudflare/output/`, and the `cf` CLI uploads it:

```bash
npm run deploy
```

Uploads are incremental: only changed files are sent. Cache rules live in `public/_headers`; link previews use `public/og.jpg`, rendered from the app itself.

## Licence and sources

The code and the story texts in this repo are MIT licensed, see `LICENSE`. The painting (Hieronymus Bosch, about 1490 to 1510, Museo del Prado) is in the public domain; the scans come from Wikimedia Commons and are not part of the repo, nor are the Klim fonts.
