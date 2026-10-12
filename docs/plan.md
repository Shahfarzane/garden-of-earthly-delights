# The Garden of Earthly Delights, painted live in JavaScript

Goal: a local web app where the whole triptych is painted at runtime by JavaScript (WebGL2 brush strokes, Canvas2D creatures, Web Audio synthesis). The reference JPEGs are only used offline, by an analyzer that plays the role of a copyist and writes brush-stroke data. Nothing on screen is a decoded photograph.

Decisions (2026-10-12, confirmed with Shahin):
- Painting method: brush-stroke engine. Offline analyzer emits strokes; the browser paints every stroke with procedural brushes.
- Zoom depth: whole painting at 19,568 px width (the tile set at 1/8), plus deeper levels (1/4, 1/2 of the 156,547 px source) around the 46 story points.
- Hosting: local Vite app. No size limit on stroke data.

## Sources

| source | size | use |
| --- | --- | --- |
| the 18 Prado tiles, `tile-x{0..5}-y{0..2}.jpg` | 156,547 x 89,116 total, columns 29,952 (last 6,787), rows 29,212 / 29,952 / 29,952 | the only pixel source for the analyzer |
| `Bosch - The Garden of Earthly Delights/*.jpg` | 18,000 px copies | eyeballing and quick previews only |
| the Bosch POI data Shahin supplied (a JS file; not in the repo) | 46 POIs, 105 sound zones (POAs), 2 tours | story text, positions, sound-zone layout. Coordinates are normalized to the full triptych (x, y both 0..1). Verified: "Adam and Eve" (0.129, 0.716) and "Tree man" (0.873, 0.388) land on those figures. |

Upstream: https://commons.wikimedia.org/wiki/Template:Tile_set/The_Garden_of_Earthly_Delights/grid

## World and levels

- World unit: 1 source pixel. World is 156,547 x 89,116.
- Level z has scale 2^(z-9): z=9 is the full source, z=6 is 19,568 x 11,140 (main full-coverage level), z=0 is 306 px wide.
- Tiles are 256 x 256 px at their level.
- Coverage: z=0..6 everywhere; z=7 and z=8 only inside hotspot regions (POI circles, padded). Beyond the deepest level the renderer keeps painting the existing strokes at higher resolution, so zoom shows crisp brushwork instead of blur.

## Stroke model (shared by analyzer and renderer)

One stroke = an arc ribbon with round caps:
center (cx, cy), tangent angle, arc length, curvature, width, sRGB color, opacity, seed.
Footprint alpha = soft capsule distance x subtle bristle streaks (deterministic hash of seed), so the CPU simulator in the analyzer and the GLSL renderer produce the same pixels.

Binary tile file `public/data/strokes/{z}/{x}_{y}.bin`: header + packed 12-byte records, positions relative to the tile, quantized.

## Analyzer (tools/, Node + sharp)

1. `prepare`: decode the 18 source tiles with JPEG shrink-on-load, cut them into level-6 256 px target tiles (raw RGB), build z<6 by box reduction, cut z=7/8 targets only for hotspots.
2. `paint`: per level, coarse to fine, per tile (worker threads): render the ancestors' strokes exactly as the browser will, then Hertzmann-style layered strokes (brush radii per level, error threshold, stroke tracing along isophotes from the structure tensor, arc fit, color from the target along the path). Keep strokes whose center is inside the tile.
3. `effects`: low-res effect map (water, fire/glow, foliage, sky masks) from color classification inside hand-drawn region polygons.
4. Report per level: stroke count, bytes, PSNR of simulated canvas vs target. Gate: visual check of rendered crops next to the reference at z=6.

## Browser app (src/, vanilla JS, Vite, WebGL2)

- Camera: pan/zoom with inertia, wheel, pinch, drag, keyboard, double-click, rubber-band clamp at the painting edges.
- Tile painter: atlas of 256 px tiles, LRU; a tile at level z draws strokes of levels 0..z (ancestor tiles plus neighbors for overlap). New tiles get painted in progressively (strokes appear) while the parent tile shows upscaled underneath.
- Ground and frames: procedural oak panel, chalk ground, carved frames and hinges, craquelure and varnish in the composite pass.
- Composite shader: effect-map driven water ripple and shimmer, fire flicker and heat haze with glow, foliage sway, sky light; per-POI "breathing" displacement for a few creatures.
- Living layer (Canvas2D, hand-authored): flocks from the Eden rock, swans, fish, butterflies, fountain drops, bubbles, embers, smoke, searchlights and lightning over the burning city, lantern flicker.
- Audio (Web Audio, all synthesized): section beds (Paradise, Garden, Hell) plus positional voices placed on the 105 sound zones and the POIs (fountains, birdsong, owl, water, fire, bells, drums, hurdy-gurdy, harp, lute, the melody written on the sinner's buttocks transcribed from the full-resolution tile).
- Story: POI markers, story drawer with the Data.json text, browser speech narration, Highlight and Klokhuis tours with camera flights, minimap, section indicator.
- Intro: the closed triptych exterior (Creation of the World, grisaille) hand-painted in JS, shutters open onto the interior.

## Phases and gates

| phase | deliverable | verification |
| --- | --- | --- |
| 0 | scaffold, git, tools env | `npm run dev` serves a page |
| 1 | prepared targets z=0..6 + hotspot z=7/8 | spot-check crops against the 18k JPEG |
| 2 | stroke analyzer + shared stroke model | PSNR per level, side-by-side crops, bytes per level |
| 3 | WebGL engine (camera, tiles, paint-in, frames) | screenshots at 5 zoom depths, fps |
| 4 | effects map + composite shader | screenshots/recordings of water, fire, sway |
| 5 | living layer | visual check per section |
| 6 | audio engine | play-through per zone, no clipping, CPU budget |
| 7 | story UI, tours, intro exterior | click-through of both tours |
| 8 | polish, perf, final sweep | full browser pass, desktop + mobile viewport |

## Risks

- Fidelity of thin dark contours at z=6 (strokes are at least ~2 px wide). Mitigation: finest brush radius ~1 px plus a linework pass if PSNR or the eye says so.
- Data size and analyzer runtime. Mitigation: adaptive strokes (only where error is high), worker threads, quantized records.
- Memory: a full source tile is 875 MP. Mitigation: JPEG shrink-on-load (1/8, 1/4, 1/2) and per-hotspot extraction.

## Progress (2026-10-12)

| phase | status | notes |
| --- | --- | --- |
| 0 scaffold | done | Vite 8, git, sharp 0.35 |
| 1 targets | done | z0..z6 from tiles at 1/8 with craquelure removal; z7/z8 hotspot targets keep the real cracks (the deep filter posterized paint, see tools/prepareDeep.js) |
| 2 analyzer | done | 15.4 M strokes, 185 MB for z0..z6, blurred PSNR 37.2 dB at z6; dual error test (unmasked low-frequency color + texture-masked detail) |
| 3 engine | done | atlas painter, paint-in, camera, input, verified GPU tile == analyzer simulation |
| 4 effects | done | effects map from hand-traced regions; water crests, ice sheen, fire glow and haze, sway, sky, lightning, cavalcade gallop, bobbing waterfowl, procedural craquelure faded inside deep hotspots, oak frames and hinges |
| 5 living layer | done | flock from Eden's rock, fountain jets on the painted streams, leaping fish and rings, bubbles, cavalcade dust, glass glints, blinking owl, smoke, embers, searchlights, bats, ravens, ash |
| 6 audio | done | 31 voices on the 105 zones, beds, cues, thunder synced to lightning; offline test 39/39 verified in our own browser |
| 7 story, tours, intro | done | exterior stroke-painted live from the Commons photo (Shahin chose this over the hand-coded version), shutters pull back and swing open |
| 8 polish | done | 60 fps cap, 600k strokes/frame budget, hidden-tab audio pause, phone layout, close-up intro framing; code review findings fixed and re-verified (eviction, pinch, key gating, wheel, z0 reach, resume) |
| deep hotspots | done | z7 4,398 tiles (293 MB), z8 4,765 tiles (211 MB); total stroke data 690 MB with z0..z6; real craquelure kept at these levels; verified on the owl (z7) and the buttock score (z8) |

## Round 2 (2026-10-12, Shahin's feedback)

| # | ask | plan |
| --- | --- | --- |
| 1 | new fonts (pending from Shahin), darker design, dislikes the music beds | fonts via two CSS variables; near-black board and UI; sound setting with two modes, 'nature' (no music) and 'period' (Renaissance consort), audio agent |
| 2 | infinite board, trackpad pinch zoom | free pan beyond the painting, zoom out to a small object on a dark dot-grid board, elastic far limit |
| 3 | no museum tour | remove tour, panel captions and tour UI; stories stay as quiet markers |
| 4 | painting visible immediately; exterior optional on the board | no intro gate; a "close wings" control swings the shutters shut to show the stroke-painted exterior, explorable, and open again |
| 5 | show how many strokes/pixels | strokes panel: totals per level, strokes in view, painted this session, screen pixels; "show strokes" false-colour mode |
| 6 | remove Listen | narration removed |
| 7 | animate important figures tastefully | rig engine (rotate, translate, scale displacement in the post shader; eyes, splash, glow overlays); figure survey and measurements by a subagent into src/living/rigs.js |

## Round 3 (2026-10-12): public at https://mirage.nerd.ceo

- Static Cloudflare Worker `mirage` (cloudflare.config.ts), custom domain creates the proxied DNS record; `npm run deploy` (cf CLI) uploads incrementally.
- Klim fonts ship (Shahin holds a web licence). Story texts rewritten clean-room in data/stories.json; buildScene refuses to build without them.
- The zone's Universal certificate (*.nerd.ceo) had timed out in validation and was restarted with Shahin's OK; it issued in about 80 s.
- Verified live: all assets 200, missing tiles 404, cache and security headers, real pinch, sound menu, stories, fonts.

## Round 4 (2026-10-12): public source

- Public repo https://github.com/Shahfarzane/garden-of-earthly-delights, MIT for the code, started from a fresh history so the museum's POI file (with its texts) was never published.
- `data/places.json` keeps only coordinates from that file (46 story points, 105 sound zones); `buildScene.js` joins it with `data/stories.json` and produces a byte-identical `scene.json`.
- Tiles default to `tiles/` (gitignored), or `BOSCH_TILES`.
- The strokes panel links to the source.
