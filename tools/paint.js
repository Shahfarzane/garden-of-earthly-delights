// Orchestrate the stroke analyzer: levels coarse to fine, tiles of a level in parallel.
// Usage: node tools/paint.js [--levels 0-6] [--region x0,y0,x1,y1 (normalized)] [--sim] [--workers N]
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { levelTiles, levelSize, TILE, OUT, WORK, FULL_Z, ensureDir, strokePath } from './common.js';

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }
const [zA, zB] = (arg('--levels', '0-6')).split('-').map(Number);
const region = arg('--region', null)?.split(',').map(Number);
const sim = args.includes('--sim');
const nWorkers = Number(arg('--workers', Math.max(1, os.cpus().length - 1)));
const resume = args.includes('--resume'); // skip tiles whose stroke file already exists
const deepArg = arg('--deep', null); // work/deep-plan.json: {z: {paint: [[x,y]...], circles: [...]}}
const deep = deepArg ? JSON.parse(fs.readFileSync(deepArg, 'utf8')) : null;

function tilesFor(z) {
  if (deep) {
    const list = deep[z]?.paint || [];
    return resume ? list.filter(([x, y]) => !fs.existsSync(strokePath(z, x, y))) : list;
  }
  const { nx, ny } = levelTiles(z);
  const { w, h } = levelSize(z);
  const list = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (region) {
      const x0 = x * TILE / w, x1 = (x + 1) * TILE / w, y0 = y * TILE / h, y1 = (y + 1) * TILE / h;
      // pad by one tile so ancestors of the region exist
      const px = TILE / w, py = TILE / h;
      if (x1 + px < region[0] || x0 - px > region[2] || y1 + py < region[1] || y0 - py > region[3]) continue;
    }
    if (resume && fs.existsSync(strokePath(z, x, y))) continue;
    list.push([x, y]);
  }
  return list;
}

const workers = Array.from({ length: nWorkers }, () => new Worker(new URL('./paintWorker.js', import.meta.url)));

async function runLevel(z) {
  const tiles = tilesFor(z);
  if (!tiles.length) return null;
  const t0 = Date.now();
  let next = 0, done = 0, strokes = 0, bytes = 0, before = 0, after = 0, afterB = 0;
  await new Promise((resolve) => {
    const feed = (w) => {
      if (next >= tiles.length) return;
      const [x, y] = tiles[next++];
      w.postMessage({ z, x, y, sim, circles: deep?.[z]?.circles || null });
    };
    for (const w of workers) {
      w.removeAllListeners('message');
      w.on('message', (r) => {
        done++; strokes += r.strokes; bytes += r.bytes; before += r.before; after += r.after; afterB += r.afterB;
        if (done % 50 === 0 || done === tiles.length) process.stdout.write(`\r  z${z}: ${done}/${tiles.length}`);
        if (done === tiles.length) resolve();
        else feed(w);
      });
      feed(w);
    }
  });
  const s = {
    z, tiles: tiles.length, strokes, mb: +(bytes / 1e6).toFixed(2),
    perTile: Math.round(strokes / tiles.length),
    psnrBefore: +(before / tiles.length).toFixed(2), psnrAfter: +(after / tiles.length).toFixed(2), psnrBlur: +(afterB / tiles.length).toFixed(2),
    sec: +((Date.now() - t0) / 1000).toFixed(1),
  };
  console.log(`\r  z${z}: ${JSON.stringify(s)}`);
  return s;
}

const stats = [];
for (let z = zA; z <= zB; z++) { const s = await runLevel(z); if (s) stats.push(s); }

// manifest of deep tiles that hold strokes (levels past the full-coverage level)
const manifest = { deep: {} };
for (const d of fs.existsSync(path.join(OUT, 'strokes')) ? fs.readdirSync(path.join(OUT, 'strokes')).filter((n) => /^\d+$/.test(n)) : []) {
  const z = Number(d);
  if (!(z > FULL_Z)) continue;
  manifest.deep[z] = fs.readdirSync(path.join(OUT, 'strokes', d)).filter((f) => f.endsWith('.bin') && fs.statSync(path.join(OUT, 'strokes', d, f)).size > 0).map((f) => f.slice(0, -4));
}
fs.writeFileSync(path.join(OUT, 'strokes', 'manifest.json'), JSON.stringify(manifest));
ensureDir(OUT);
ensureDir(WORK);
fs.writeFileSync(path.join(WORK, `paint-stats-${Date.now()}.json`), JSON.stringify(stats, null, 1));
for (const w of workers) w.terminate();
