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

## Browser app (src/, TypeScript since Round 10, Vite, WebGL2)

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

## Round 6 (2026-10-20): an adaptive paint budget

Shahin's call after Round 5: keep the budget logic, make it adapt to the device, defer the ancestor stroke index. `FRAME_INSTANCE_BUDGET` became `FrameBudget` in `src/engine/budget.js`, with 600k as its ceiling. Only the number of instances drawn per frame changes. What is drawn and the order stay the analyzer's.

Method as in Round 5, on the M1 Pro (MBPro16, 16-core GPU), Chrome for Testing 155.0.8059.84 (ANGLE Metal), a headed window at 1600x1000 CSS px and dpr 2 (3200x2000 canvas), 120 Hz display. The view is "Ear and Knife" at scale 0.1 (z7) and 0.2 (z8), 176 tiles each. A cold fill means: files loaded, tiles of z3 and up dropped, paint-in off. Raw rAF intervals were recorded for every callback in the visible window, and loop intervals for every frame the painter ran.

To stand in for a slow GPU, the bench repeats every stroke draw k-1 more times into an atlas slot nobody sees: the same instances, so the same vertex and fragment work, and stroke painting costs k times as much. Compositing and the post pass keep their real cost. With a fixed budget at k=4, 100k and 150k per frame run with no late frame and 300k runs late (raw p50 16.6 ms, max 26), so this "GPU" can paint 150k to 300k a frame.

### The 60 fps cap dropped frames

`MIN_FRAME_MS = 1000 / 61` skipped every other 120 Hz frame as intended, but rAF timestamps jitter between 7.3 and 9.3 ms, so two frames sometimes add up to less than 16.39 ms and the loop waited for a third. At idle 29 of about 220 loop frames ran at 25 ms, and every fill in the table below had 3 to 7 such frames. The threshold is now 12.5 ms, one and a half 120 Hz frames (commit 4012901): 241 loop frames in 4 s at idle, none over 20 ms. It still runs every frame at 60 Hz, and 72 fps instead of 48 on a 144 Hz screen.

### How the budget adapts

- The signal is the raw interval between animation frames. When the GPU cannot finish a frame's strokes in time, the next frame comes late. Late means past the loop's 16.7 ms slot by half a refresh: 20.8 ms at 120 Hz, 25 ms at 60 Hz. A 16.7 ms interval at 120 Hz only skips a frame the loop would not paint, and counting it as late cut the budget in steps from 253k to 51k in one trace.
- A late frame after painting cuts the budget to what was painted times 16.7 ms over the interval, 0.25 to 0.8. The two frames after a cut cannot cut again, because their lateness can still be the GPU finishing frames queued before it. Without this hold one fill cascaded from 260k to the 20k floor.
- A second late frame within 30 frames also caps regrowth at 90% of what was painted. One late frame alone leaves the cap: in one suite run a single outside event (other sessions share this GPU) set the cap at 195k on the fast path, and the next four fills ran slow until it relaxed.
- On-time frames where the budget held work back grow it by 20% and relax the cap by 0.3%. Idle frames change neither, so a learned limit survives between fills and a slow device does not re-learn it with a late frame each time.
- Stalls longer than four frames (a shader compile, a busy main thread) and late frames that painted under half the budget cut by at most a half and leave the cap alone. Intervals while nothing paints measure the refresh rate.
- The budget is strict. The shipped code checked it only between tiles, so a frame painted 602k to 772k at 600k, and one z8 tile (180k instances) could never be split. Now a frame stops at its budget inside a file and the next frame resumes at the same record. A tile stays behind its parent until its coarser levels are all down, as before.
- The budget is a whole number. While it was fractional, `start * 12` stopped being a multiple of 4, ANGLE converted the vertex buffer on the fly (stalls of 33 to 118 ms) and the draws read misaligned records.

Pixel identity: 24 tiles at z7 and 24 at z8, painted with paint-in off at 600k and again at 30,000 and at 7,777 instances per frame (763 and 1,033 frames of resumes inside files), read back byte-identical when they land in the same atlas slot. Tiles that land in another slot differ by at most 1 in about 0.05% of bytes, 600k against 600k included: vertex snapping depends on where the slot sits in the atlas, in the shipped code too.

### Before and after

| cold fill, 176 tiles | frames | ms | raw rAF p50 / max | loop frames over 20 ms | over 34 ms |
| --- | --- | --- | --- | --- | --- |
| z7, before (bf717e0) | 34 | 575 to 592 | 8.3 / 9.3 | 3 to 5, all the cap | 0 |
| z7, after | 38 | 617 | 8.3 / 9.4 | 0 | 0 |
| z8, before | 44 | 758 to 775 | 8.3 / 9.3 | 5 to 7, all the cap | 0 |
| z8, after | 51 | 833 | 8.3 / 9.4 | 0 | 0 |
| z7 x4 GPU, before | 34 | 925 | 25.0 / 41.5 | 30 of 33 | 1 |
| z7 x4, after, budget starting at 600k | 90 | 1,550 | 8.3 / 26.0 | 8 | 0 |
| z7 x4, after, learned | 161 | 2,667 | 8.3 / 9.4 | 0 | 0 |
| z8 x4 GPU, before | 44 | 1,346 | 29.6 / 84.2 | 41 of 43 | 6 |
| z8 x4, after, starting at 600k | 93 | 1,600 | 9.0 / 25.1 | 8 | 0 |
| z8 x4, after, learned | 185 | 3,067 | 8.3 / 9.4 | 0 | 0 |
| z7 x8 GPU, after, starting at 600k | 211 | 3,588 | 8.3 / 50.6 | 5 | 2 |
| z7 x8, after, learned | 177 | 2,992 | 8.4 / 25.8 | 7 | 0 |

At full speed the budget never left 600k and no frame was late, before or after. This M1 Pro paints the shipped code's 772k frames on time too. The strict budget costs 4 frames at z7 and 7 at z8 (fills about 7% longer) because frames no longer overrun. A 700k ceiling would bring the old fill speed back on this Mac, and the controller would make it safe on slower GPUs; it stays at 600k as decided. On the slow GPU the fill takes longer, since the same work now goes into frames that make their slot. The first fill on a slow device costs 5 to 8 frames of about 25 ms (two of about 50 ms at x8) while the budget comes down from 600k. Starting lower would cost the fast Macs a few frames of their first fill instead.

| flight, whole painting to "Ear and Knife", paint-in on | ms | raw rAF max | over 20 ms | over 34 ms |
| --- | --- | --- | --- | --- |
| before | 2,150 to 2,192 | 9.4 | 0 | 0 |
| after | 2,158 to 2,174 | 9.4 | 0 | 0 |
| x4 GPU, before | 2,775 | 58.4 | 46 | 28 |
| x4, after, budget starting at 600k | 4,434 | 25.4 | 3 | 0 |
| x4, after, second flight | 4,184 | 16.7 | 0 | 0 |

A pan at 3 px per frame at z7 and z8 runs at raw p95 9.3 ms and max 9.4 ms, at full speed and on the x4 GPU alike, with the budget at 600k: a slow pan starts few tiles per frame. Idle at z7 is p50 8.3, p95 9.3.

Limits: measured on this Mac only. The simulation scales stroke painting, not compositing or the post pass, and no phone was at hand. The ancestor stroke index of Round 5 stays unbuilt.

## Round 7 (2026-10-20): part of Mirage

Mirage is Shahin's site for every painting he repaints with code, built in klim-paintings (React 19, a layout taken from Klim Type Foundry's family pages). The Garden has to look like part of it. Shahin's preference: one project if possible, otherwise a matching interface.

### One project or two

Both checkouts, read on 2026-10-20:

| | Mirage (klim-paintings) | the Garden |
| --- | --- | --- |
| stack | React 19 prerendered per route, TypeScript, Tailwind 4, Vite+ with oxlint and oxfmt, pnpm | plain JavaScript modules, Vite 8, npm |
| a painting | one `payload.gz` of 3 to 5 MB, fetched whole; every stroke drawn every frame into a canvas capped at 2.4 MP | 13,715 stroke files (690 MB) in a tile pyramid, streamed per view, each tile painted once into an atlas |
| a page | a scrolling document: navbar, painting box, information, footer | one fixed full-screen board that takes wheel, pinch, drag and keys |
| build output | 86 files, 26 MB | 13,775 data files, 691 MB, plus the site |
| repository | private, Söhne fonts committed | public and MIT (Shahfarzane/garden-of-earthly-delights), fonts kept out; the strokes panel links to it |
| hosting | none configured yet; takes over mirage.nerd.ceo | the Cloudflare Worker `mirage` on mirage.nerd.ceo |

A merge would share the design tokens and the navbar. The two painting runtimes have nothing in common: Mirage's draws a whole painting from one buffer, and the Garden's engine exists because 57.9 million strokes do not fit in one. What a merge would cost:

- The public source. The Garden's code would move into a private repository that ships licensed fonts, so either its MIT release and the source link end, or Mirage goes public after its fonts leave the repository.
- Size on every deploy. Each Mirage build would copy 691 MB and 13,800 files. Cloudflare allows 20,000 files per Worker version on the Free plan and 100,000 on Paid, so a second painting at this depth would not fit on Free.
- Tooling. Mirage's dev server, prerenderer, linter and formatter would all need to skip the stroke data and the engine, as `vite.config.js` here already does for the watcher.
- The first load. React and Mirage's shell would add script to a page whose content is one canvas.
- The analyzer (`tools/`, Node with sharp) and its regeneration steps would live in a site's repository.

Decision: the Garden stays its own project, and its interface takes Mirage's design exactly: Mirage's tokens, lozenges, navbar and menu, with a breadcrumb "Mirage / The Garden of Earthly Delights" whose first crumb leads to the Mirage index (`MIRAGE_URL` in `src/ui/ui.js`). Mirage already lists the Garden as an external work behind one constant, `GARDEN_URL` in its catalog. Both sit under one address without one repository: Cloudflare routes a path of Mirage's domain to the Garden's Worker (below).

### The interface in Mirage's design

Values come from klim-paintings' source, each cited with file and line at the top of `src/style.css`, and were checked against its running dev server's computed styles at 1440x900 and 390x844: lozenges 28 px high with 0 8px padding and 2 px corners, 5 px apart, 10 px above and below, 20 px margins (10 px on phones), the menu panel in the last two columns of twelve (three at 1366 and below, four at 1024 and below) on `#1c1c1c`, separators 1 px `#383838` with 5 px margins, and the colour mixes `#e2e2e2` to `#1c1c1c` of its black and white scheme. The type is Mirage's too, Söhne (Shahin, 2026-10-20: "since we wanna keep the same design as Klim, lets use whatever klim-paintings is using"), loaded as its `base.css` loads it from the untracked `fonts/` folder, with the menu and outward-link icons as glyphs of Söhne's icon face. A page loads Buch and the icon face, 47 kB, where Die Grotesk and Martina Plantijn took 243 kB.

| here before | here now, in Mirage's terms |
| --- | --- |
| icon rail bottom right, ten buttons with tooltips | navbar: breadcrumbs "Mirage / The Garden of Earthly Delights" on the left; Exterior, Strokes and Sound lozenges and the menu on the right, wrapping under the menu below 1024 px and stacking beside the crumbs on phones, as Mirage's do |
| story markers, living painting, varnish and full screen as icons, hidden on phones | menu items with an On or Off value, on every screen |
| zoom out, zoom in, whole painting in the rail | three lozenges bottom right |
| sound and strokes popovers above the rail | panels under the navbar in the right-hand columns; the toggles are lozenges that stay filled while on, as Mirage's Sound and Strokes |
| story drawer full height on the right | a panel in the right-hand columns under the navbar (four of twelve, five at 1366, six at 1024), a sheet at the foot below 768 px |

Checked with real input (CDP mouse, wheel, keys and pinch, no JavaScript clicks) at 1440x900, 1728x990 and 390x844: 41, 41 and 40 checks pass, covering every lozenge and menu item, the sound modes, the stroke view, arrow keys in the menu, Escape returning focus, drag, two-finger scroll, trackpad and touch pinch with the page left unscaled, the pan and zoom keys, hold L, a story opened from its marker and closed, the minimap and the wings. Away from the lozenges, `elementFromPoint` finds the canvas everywhere, the navbar row included.

### The first visit

Measured on the live site with a cold cache in Chrome for Testing at 1728x990, until every tile of the first view was painted:

| | requests | MB | strokes | first contentful paint | full view |
| --- | --- | --- | --- | --- | --- |
| dpr 1 | 97 | 8.5 | 83 files, 7.7 MB (z0 to z3) | 220 to 248 ms | 1.18 to 1.21 s |
| dpr 2, as on the MacBook | 317 | 24.0 | 303 files, 23.2 MB (z0 to z4) | 168 ms | 2.14 to 2.51 s |

The 8.3 MB measured earlier is the dpr 1 case. On a Retina screen `renderLevel` picks z4 for the whole triptych, and a z4 tile needs every coarser file under it, so the first view costs three times as much. The stroke files go out uncompressed (`application/octet-stream`), and generic compression gains little: brotli at its best level saves 12 to 13% on them, splitting each record's 12 bytes into planes first saves 21%.

Proposal, not built, biggest first:

1. Show the first view one level coarser on dense screens, then refine. Request z3 for the opening whole-triptych view and z4 once it is complete: the dpr 1 figures, 8.5 MB and 97 requests, before the first full view at dpr 2 instead of 24 MB and 317, with the sharper level painting in afterwards over the coarser one as tiles already do. Pixels stay the analyzer's at every level.
2. One file per level for z0 to z3 (83 files become 4), stored as byte planes with gzip and decoded by `DecompressionStream`: 7.7 MB of strokes become about 6.2 MB. The records after decoding are the same bytes, so the GPU twin is untouched.
3. Load `effects.png` (0.43 MB) after the first full view; only the water, fire and sway effects use it.
4. Version the data path (`/data/v1/strokes/...`) and serve it `immutable` for a year instead of `max-age=86400`, so a return visit after a day does not revalidate 300 files.

### At mirage.nerd.ceo/garden/

Shahin's call (2026-10-20): Mirage takes the root of mirage.nerd.ceo and the Garden lives at /garden/. The address is in one place, `site.config.js` (`HOST`, `BASE`).

- Vite builds with `base: BASE` into a `garden/` folder of the Worker's assets: a Worker on a route serves the paths its folders mirror (Cloudflare, "Serving a subdirectory"). The app takes the base from `import.meta.env.BASE_URL` for every fetch of the scene, the effects, the strokes and the exterior. The manifest's URLs are relative, the canonical and preview addresses come from `site.config.js`, and the build writes `_headers` at the asset root with the `/garden/` paths.
- `cloudflare.config.ts` drops the custom domain for two routes, mirage.nerd.ceo/garden (redirected to /garden/ by `auto-trailing-slash`) and mirage.nerd.ceo/garden/*, in the zone nerd.ceo. Cloudflare's custom domains page has a route on a path of a custom domain's host take that path, so Mirage's custom domain and these routes can share the host.
- The Worker is renamed from `mirage` to `garden`, so deploying this branch creates a second Worker and leaves the live one alone.
- The breadcrumb's "Mirage" and the menu's first item go to `/`, same origin and tab.
- Checked on the dev server at /garden/: all 250 requests of a story deep link stay under /garden/, the real-input checks pass (42 at 1440x900 and 1728x990, 41 at 390x844, Söhne and the breadcrumb included), and `vite build` lays out `assets/garden/` with `_headers` at the asset root.

The switch, when Shahin deploys (not done here):

1. `npm run deploy` in this repo creates the Worker `garden` with its two routes. mirage.nerd.ceo stays on the old Worker `mirage`, which keeps serving the old Garden at the root, and /garden/ already goes to the new Worker.
2. Mirage's deploy takes mirage.nerd.ceo as its custom domain. Either detach the domain from the old Worker `mirage` first, or name Mirage's Worker `mirage`, which replaces the old one in place, domain included.
3. Delete the old Worker `mirage` if it is still there, and point Mirage's `GARDEN_URL` at /garden/.

Old shared links such as mirage.nerd.ceo/#story=… will open Mirage's index after the switch. A redirect for them has to be in Mirage's page script, since a server never sees the hash. That is a follow-up for Mirage.

Open question for Shahin: when to push and deploy this branch.

## Round 8 (2026-10-20): the frame stays, the painting zooms

Shahin: "the frame should stay fixed where it is and we can only zoom", meaning a trackpad pinch zooms the painting and never the frame. This replaces Round 2's infinite board, where the whole triptych could shrink to an object on the dark board.

- At rest, the framed triptych fills the screen under the navbar, inside the margins, above a band as tall as the navbar for the zoom lozenges, as Mirage's painting box does (`Camera.layout`, `setBox` from `src/ui/ui.js`). The post pass draws the outer frame, the drop shadow and the board at that rest view, so they never move, and the painting through the frame's opening at the camera. Between the wings, their frames and hinges stay part of the painting and move with it. The lip shading follows the fixed opening.
- The camera zooms in from rest and never out of it. It is clamped so the opening only ever shows painting, and every route goes through the same clamp: pinch as ctrl + wheel (Chrome, Firefox) and as gesture events (Safari), touch pinch, drag, two-finger scroll, arrow keys, `+`, `-`, `0`, double-click, the zoom lozenges, the minimap and story flights. A flight's zoom-out arc stops at rest. At rest the painting cannot pan, since it already fills the opening.
- With the wings shut, the opening is the centre panel's and the shutters are clipped to it, so the exterior zooms inside the centre frame.
- The living layer, story markers and taps stay inside the opening. Tiles are requested only for what it shows: at the Round 6 z7 view, 144 tiles instead of 176, filled in 32 frames instead of 38, none late.
- Checked with CDP input at 1728x990: 30 of 30 checks. Trackpad pinch held the point under the fingers to 0.00 px. Screenshots of four strips of the frame stayed byte-identical through pinching, pinching out past rest, Safari gestures (dispatched from script, since Chrome cannot synthesize them, and every one prevented), drags and scrolls to all four edges, keys, double-click, the zoom-out lozenge, a story flight (the opening stayed on painting every frame) and the closed exterior. At 390x844 with touch, 8 of 8, the page never scaled. The interaction checks of Round 7 pass again: 43, 43 and 42.

On a phone held upright, the framed triptych is short, about 205 px of an 844 px screen, so the zoomed painting is seen through that strip. Turning the phone fills it. Should the frame hug the screen instead, cropping the triptych at rest, that is Shahin's call.

## Round 9 (2026-10-20): phones held upright, and the first view

### The frame hugs an upright phone

Shahin chose the hugging frame for upright phones. On portrait screens up to 768 px wide, the frame runs round the box under the navbar and the painting covers its opening. At 390x844 that is a 347x659 px opening where Round 8 left a 205 px strip. At rest the crop is the centre panel's middle: about 45,700 of the triptych's 154,280 world px in width, so the cavalcade round the Pool of Youth (42,300 across) just fits. That is the painting's namesake and its visual centre. A sideways pan at rest reaches the wings, and pinch and pan work as on desktop, inside the same clamp. The frame is drawn round the opening in screen space, the shutters swing behind it, and the whole-painting lozenge reads "Centre" there. Desktop and landscape screens keep the framed whole triptych.

Testing on the phone sizes turned up two touch bugs, both fixed:

- A finger that landed on a story marker or a lozenge gave the pinch to the browser, which scaled the page (`visualViewport.scale` 1.6). The interface layer now has `touch-action: none`, while the story text and the panels still scroll. A touch that starts on a marker is captured by the board, so it pans and pinches the painting, and a plain tap opens the story as anywhere else.
- At rest on a phone, the central story circles are big enough to tap, so the tap that closed a panel also opened the Pool of Youth. A tap that closes a panel now only closes it.

Checked with real input: the interaction suite passes at 390x844 (43), 768x1024 (43), 844x390 (44), 1440x900 (44) and 1728x990 (44). The fixed-frame checks pass at 390x844 and 768x1024 (15 each, with the sideways pan at rest, touch pinch, touch pan, pinching back to rest and the wings shut) and at 1728x990 (30).

### Coarse first, then sharp: measured, and already the case

Shahin approved Round 7's first proposal: request the first whole-triptych view one level coarser on dense screens, and sharpen in place once it is complete. Before building it, the first visit was measured again on a local production build (`vite preview`, the real stroke files), with the network held at 50 Mbps and 20 ms latency, cache off, at 1728x990:

| | requests | MB | first paint | z3 view complete | z4 view complete |
| --- | --- | --- | --- | --- | --- |
| dpr 1 | 95 | 8.28 | 176 to 180 ms | 2.03 s | |
| dpr 2, as shipped | 315 | 23.66 | 184 ms | 2.05 to 2.07 s | 4.57 s |
| dpr 2, z4 held back until z3 is complete | 315 | 23.66 | 180 ms | 2.03 to 2.04 s | 5.15 to 5.19 s |

The code already loads the coarse level first: the store fetches coarser files first, and a z4 tile not yet painted shows its z3 parent. So the complete z3 view arrives at dpr 2 only 20 to 30 ms after dpr 1. Round 7's "24 MB before the first full view" counted the moment the sharper level was complete; the complete coarse view was already there at 8 to 11.5 MB. Holding z4 back until z3 is done gains about 25 ms on the coarse view and costs 0.6 s on the sharp one, so it is not shipped. The approved behaviour, coarse first and then sharp in place, is the one the code has.

With everything in this round, same conditions:

| | requests | MB | first paint | complete view | sharp view |
| --- | --- | --- | --- | --- | --- |
| 1728x990, dpr 1 | 95 | 8.29 | 184 to 196 ms | 2.04 to 2.05 s (z3) | |
| 1728x990, dpr 2 | 315 | 23.66 | 176 ms | 2.05 s (z3) | 4.56 to 4.59 s (z4, 220 files, 15.4 MB) |
| 390x844 upright | 71 | 6.65 | 176 to 180 ms | 1.75 s (z3) | |

The live site measured 1.18 to 1.21 s and 2.14 to 2.51 s in Round 7 over a faster real connection, so compare these rows with each other, not with those. The cuts still worth making are Round 7's second to fourth proposals: packed files per level, effects after the first view, and immutable versioned data.

## Round 10 (2026-10-20): TypeScript

The code is strict TypeScript: 51 files, 9,593 lines. `src/` has 34 (8,216 lines: the 32 converted, plus `scene.ts` and `dom.d.ts`), `tools/` 14 (1,256 lines), and the root the three configs. Behaviour is unchanged. Earlier rounds name the files as they were then, with `.js`.

- Two projects, both strict and `noEmit`: `tsconfig.app.json` for `src/` (DOM, Vite's client types) and `tsconfig.node.json` for `tools/` and the build configs (Node types). `npm run typecheck` runs `tsc -b` over both with TypeScript 7.0.2, the native compiler, in about 0.3 s. `npm run check` runs it, then the build.
- The analyzer still runs with plain `node`: Node 24 strips the types. `erasableSyntaxOnly` and `verbatimModuleSyntax` keep `tools/` and what it imports from `src/` (`shared/strokeModel.ts`, the data types in `scene.ts`) free of enums, namespaces and parameter properties. Imports name their `.ts` files, which Node requires and Vite accepts.
- Typed shapes: the 12-byte stroke record (`Stroke`), scene.json and stats.json (`src/scene.ts`; `buildScene.ts` and `manifest.ts` write against them), the camera's rects and flights, stroke file states (idle, queued, loading, ready, missing), tile states (wait, base, paint, done), the post pass's rigs and frame info, the rigs as a discriminated union, the audio option objects. Bird species, voice types, cues and sprite names are literal unions checked with `satisfies`, so a misspelt name fails the typecheck.
- No `any`, no `@ts-expect-error`. 63 non-null assertions: DOM lookups of markup the same code wrote, tile fields set when a tile leaves `wait`, the audio context once started. About 45 type assertions: event targets, `Object.keys` and `Object.entries`, palette lookups with a fallback, items filled right after creation.
- `noUncheckedIndexedAccess` stays off. It flags 580 index reads, nearly all typed-array reads in the hot loops of the boids, the rasterizer, `decrack` and the analyzer's blur.
- The types found two oddities, both kept as they behave. `vite.config` passed `parsed.settings` to `writeRootConfig`; the parsed config has no such field, so the root config holds the build context only, and the call now passes `undefined`. The frame loop passed `dt` to `UI.update`, which takes no argument.

Verified, the JS at 9b0e6ae against the TypeScript:

- Analyzer, in a scratch copy of the repo so nothing touches the real stroke data: interior levels 0 to 2 from targets cut out of the 18,000 px copy, exterior levels 0 to 1 through `prepareExterior`, then `simPreview`, `effects`, `buildScene`, `manifest` and `decrack`. 143 output files, byte-identical under `cmp`, both run with plain `node`. The JS baseline ran twice to rule out nondeterminism. `prepare` and `prepareDeep` stop at the same missing-scan error.
- Bundle: the unminified production bundle differs in executable code at six places, each equivalent: `String(r.status)` and `String(value)` where the runtime already converted, `Number()` around two booleans a sort subtracted, a local for the scene buffer in `Renderer.frame`, an `isWarp` guard around the same `KIND` lookup, and `ui.update()` without the ignored argument. The rest is class field declarations, comments and three GLSL comments.
- Interaction suites with real CDP input: 44, 44, 44, 43 and 43 at 1728x990, 1440x900, 844x390, 768x1024 and 390x844. Fixed-frame checks: 30, 15 and 15. Same counts as before.
- Round 6 identity: 24 z7 tiles at 600k, 30,000 and 7,777 instances per frame took 4, 67 and 258 frames, and same-slot tiles read back byte-identical. Same result as before, to the frame count.
- Screenshots at 1728x990 and 390x844 (default, stroke view, menu, a story; reduced motion): 9 of 10 byte-identical. The 1728x990 story view differs in 90 px by at most 2 levels; two loads of the JS differ in 68 px the same way, from atlas slot placement.
- Sprites at three sizes per palette and pose, the motion behaviours, the camera, the animator, the living layer at 13 views, the sound zones and 73 offline audio renders, hashed with seeded randomness: identical.
- `dev/audio.html` and `dev/life.html` load from `.ts` without errors.
