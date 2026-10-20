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

## Round 5 (2026-10-20): the paint budget measured against GPU time

The idea under test: charge each `drawFile` in `src/engine/tiles.js` by the instances that can touch the 264 px slot (ancestor files are mostly clipped away) instead of the raw count, so a deep view fills in a few frames instead of 13 or more. Measured before touching the code, on the M3 Pro, Chrome for Testing 155 (ANGLE Metal), 1600x1000 CSS px at dpr 2 (3200x2000 canvas), 120 Hz display, frame loop capped at 61 fps so a rendered frame gets 16.7 ms. The GPU cost of a draw was timed with `gl.finish()` plus a 1 px `readPixels` around 30 repeats; frame pacing with `requestAnimationFrame` intervals in a visible window (a hidden page throttles to 1 Hz and stalls inside the WebGL command stream, so nothing was timed there).

| z7 tile 7/129/25, 26 files, 166k instances | ms | note |
| --- | --- | --- |
| full draw into the slot | 2.27 (3.45 in a second run) | the whole tile, all levels |
| same draws with a 1 px scissor (vertex pass only) | 1.17 | half the time is vertex work |
| same draws pushed outside the clip volume | 1.43 of 3.45 | 8.6 ns per clipped instance |
| own level, 9 files, 69.9k instances | 0.70 | 10 ns per instance, 8 of the 9 files are neighbours, mostly clipped too |
| z0 (16.6k), z1 (18.4k), z2 (12.5k), z3 (12.7k) | 0.42, 0.28, 0.24, 0.21 | 15 to 25 ns per instance: the few coarse strokes that touch cover up to the whole slot (a z0 stroke at scale 128 is about 70k fragments) |
| z4 (19.6k), z5 (4.0k), z6 (12.5k) | 0.21, 0.07, 0.14 | 11 to 18 ns per instance |
| z8 tile 8/258/50, 180k instances | 5.09 full, 2.45 vertex only | ancestors magnified further cost more fragments |

So in own-level units a clipped ancestor instance costs 0.86, not 0.05, and no level's instances are cheaper than the own level's. The data confirms the clipping: only 0.4 to 4 % of a z0..z4 file's strokes touch a z7 slot (13 % at z5, 27 to 33 % at z6); the REACH = 40 estimate would say 7 to 23 %, since the real reach past a tile is 22 px for z >= 1 (85 px at z0). Files have no spatial order (the distance between consecutive records equals the distance between random records; records run coarse to fine), so no contiguous sub-range can select by position.

| per-frame budget (paint() called N times per frame) | cold fill, 176 z7 tiles, files loaded, paint-in off | rAF intervals during that fill | cold fill z8 | rAF intervals z8 |
| --- | --- | --- | --- | --- |
| 600k, as shipped | 35 frames, 636 ms | p95 9.1, max 16.7, one over 12 ms | 42 frames, 850 ms | max 10.5, none over 12 |
| about 2M (x3) | 12 frames, 280 ms | max 30.2, nine over 12, one over 20 | 14 frames | max 41.4, ten over 12, five over 20 |
| about 3.4M (x5) | 7 frames, 220 ms | max 83.6, five over 20, one over 34 | 9 frames | max 42.1, eight over 20, three over 34 |

Panning at 3 px per frame at z7 and z8 keeps p95 at 9.2 to 9.5 ms and max at or under 16.3 ms at every multiplier (a slow pan starts few tiles per frame); idle at depth is p50 8.3, p95 9.3. The real flight to "Ear and Knife" (whole painting to zr 7, 160 tiles) had its files loaded in the frame the flight ended; 13 and then 6 tiles waited one and two frames for budget, and the 33 painting frames that followed are the 520 ms paint-in. GPU timer queries (`EXT_disjoint_timer_query_webgl2`) put a 600k frame 6 to 8 ms above the idle frame's compositing and post cost; ANGLE on Metal inflates these elapsed values, so they are upper bounds.

Decision: the raw instance count already tracks GPU time on this machine and `FRAME_INSTANCE_BUDGET = 600_000` is about one 16.7 ms frame of GPU work at depth (8 to 12 ms at z7, up to 17 at z8 in the synchronous calibration). Charging clipped instances at 0.05 would let a frame draw 5 to 10 times the work and drop frames exactly as the x3 and x5 rows show. The budget stays as it is; the fill is GPU-bound, not budget-bound. Measured on this Mac only; a phone GPU has less headroom, not more.

Design of the next step, an ancestor stroke index, not implemented (owner decision):

- Order can only be preserved by drawing an ascending list of the record indices that can touch the slot. Drawing one bucket list after another reorders strokes of different buckets that overlap near the bucket edge, which moves paint and breaks the analyzer twin.
- WebGL2 cannot index instance attributes. `WEBGL_multi_draw` is present here but no base-instance extension, and ANGLE on Metal issues one draw per range anyway, so sub-range multi-draws are out.
- Storage: upload each file as an RGBA32UI texture (16 B per texel, one row per 1024 records, the largest file has 15,976 records), +33 % stroke memory; drive the stroke vertex shader with a per-instance uint record index and read the record with `texelFetch`. A shared identity index buffer serves full draws, so the paint-in chunks keep working through the attribute offset. The decode arithmetic and `STROKE_FS` stay byte-identical; only the attribute plumbing changes, and `exteriorPainter.js` either keeps the old vertex shader or moves too.
- CPU side, per file at load: a 16 px grid (32x32 cells over [-64, 448)) of Uint16 record indices whose quad (`strokeExtent` at scale 1, padded 1 px) intersects the cell, about 2.5 entries per record, 5 B per record, about 30 MB with z0..z5 fully loaded. Per (tile, file): mark the cells under the slot in an n-bit set, emit ascending indices, upload to a transient index buffer, one `drawArraysInstanced` per file with count = touching.
- Expected gain: a z7 tile draws about 25k instances instead of 166k, vertex time drops from 1.2 to about 0.2 ms, fragment time stays (1.1 to 2.0 ms at z7, 2.6 ms at z8, mostly coarse strokes magnified into the slot). Fills get 1.6 to 1.8 times faster (35 frames to about 20 for 176 tiles), not the 5 times hoped for; while the tile must equal the analyzer's simulation, the magnified ancestors' fragments are the floor.
- Tradeoff to decide: a vertex shader data path change, 33 % more stroke memory and the CPU index, for about 1.7x on cold fills. Anything with a bigger upside changes what is drawn (ancestors painted once per parent and upsampled, for instance) and gives up pixel identity.
