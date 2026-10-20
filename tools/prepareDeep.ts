// Deep hotspot levels: targets for z=7 (all story points) and z=8 (small story points),
// decoded from the full-resolution source tiles with JPEG shrink-on-load.
// Writes work/targets/{z}/x_y.rgb for painted tiles plus a one-tile ring (analyzer margin),
// and work/deep-plan.json describing which tiles to paint and the hotspot circles.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { decrack } from './decrack.ts';
import {
  WORK, OUT, SOURCE_DIR, TILE, SRC_COLS, SRC_ROWS, WORLD_W,
  levelSize, levelScale, targetPath, ensureDir,
} from './common.ts';
import type { DeepPlan, Hotspot } from './common.ts';
import type { Poi, Scene } from '../src/scene.ts';

sharp.cache(false);
sharp.concurrency(4);

const scene: Scene = JSON.parse(fs.readFileSync(path.join(OUT, 'scene.json'), 'utf8'));
const PAD = 1.15;
// Deep levels keep the real craquelure: at this resolution the cracks are wide and
// high-contrast, and the morphological filter posterizes the paint around them
// (compared on the owl in the Fountain of Life, 2026-10-12). DEEP_DECRACK=1 restores it.
const DECRACK = process.env.DEEP_DECRACK === '1';
const LEVELS = [
  { z: 7, pick: (p: Poi) => !p.overview, crackRad: 4 },
  { z: 8, pick: (p: Poi) => !p.overview && p.r <= 0.03 * WORLD_W, crackRad: 8 },
];
const only = process.argv[2] ? Number(process.argv[2]) : null;

const SRC_W = [29952, 29952, 29952, 29952, 29952, 6787];
const SRC_H = [29212, 29952, 29952];

function rawPath(z: number, x: number, y: number): string { return path.join(WORK, 'raw', String(z), `${x}_${y}.rgb`); }

const plan: DeepPlan = fs.existsSync(path.join(WORK, 'deep-plan.json')) ? JSON.parse(fs.readFileSync(path.join(WORK, 'deep-plan.json'), 'utf8')) : {};

for (const L of LEVELS) {
  if (only !== null && L.z !== only) continue;
  const z = L.z, s = levelScale(z), shrink = 1 / s;
  const { w: LW, h: LH } = levelSize(z);
  const circles = scene.pois.filter(L.pick).map((p): Hotspot => ({ id: p.id, title: p.title, x: p.x * s, y: p.y * s, r: p.r * s * PAD }));
  const paint = new Set<string>();
  for (const c of circles) {
    for (let ty = Math.floor((c.y - c.r) / TILE); ty <= Math.floor((c.y + c.r) / TILE); ty++) {
      for (let tx = Math.floor((c.x - c.r) / TILE); tx <= Math.floor((c.x + c.r) / TILE); tx++) {
        const nx = Math.max(tx * TILE, Math.min(c.x, tx * TILE + TILE)), ny = Math.max(ty * TILE, Math.min(c.y, ty * TILE + TILE));
        if ((nx - c.x) ** 2 + (ny - c.y) ** 2 <= c.r * c.r && tx >= 0 && ty >= 0 && tx * TILE < LW && ty * TILE < LH) paint.add(`${tx}_${ty}`);
      }
    }
  }
  const targets = new Set(paint);
  for (const k of paint) {
    const [x, y] = k.split('_').map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx * TILE < LW && yy * TILE < LH) targets.add(`${xx}_${yy}`);
    }
  }
  console.log(`z${z}: ${circles.length} hotspots, ${paint.size} painted tiles, ${targets.size} target tiles`);

  // which source tiles feed each target tile
  const srcRect = (col: number, row: number) => ({ x0: Math.round(SRC_COLS[col] * s), y0: Math.round(SRC_ROWS[row] * s), x1: Math.round((SRC_COLS[col] + SRC_W[col]) * s), y1: Math.round((SRC_ROWS[row] + SRC_H[row]) * s) });
  const need = new Map<string, number>(); // target key -> remaining source count
  const bySource = new Map<string, string[]>();
  for (const k of targets) {
    const [x, y] = k.split('_').map(Number);
    const tx0 = x * TILE, ty0 = y * TILE, tx1 = Math.min(LW, tx0 + TILE), ty1 = Math.min(LH, ty0 + TILE);
    let n = 0;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) {
      const r = srcRect(col, row);
      if (r.x0 < tx1 && r.x1 > tx0 && r.y0 < ty1 && r.y1 > ty0) {
        n++;
        const sk = `${col}_${row}`;
        if (!bySource.has(sk)) bySource.set(sk, []);
        bySource.get(sk)!.push(k);
      }
    }
    need.set(k, n);
  }
  ensureDir(path.join(WORK, 'raw', String(z)));
  const bufs = new Map<string, Buffer>();
  for (const [sk, keys] of bySource) {
    const [col, row] = sk.split('_').map(Number);
    const file = path.join(SOURCE_DIR, `tile-x${col}-y${row}.jpg`);
    const t0 = Date.now();
    const tw = Math.round(SRC_W[col] * s), th = Math.round(SRC_H[row] * s);
    const { data, info } = await sharp(file, { limitInputPixels: false, sequentialRead: true })
      .resize(tw, th, { fit: 'fill', kernel: 'lanczos3' })
      .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const r = srcRect(col, row);
    for (const k of keys) {
      const [x, y] = k.split('_').map(Number);
      let b = bufs.get(k);
      if (!b) { b = Buffer.alloc(TILE * TILE * 3); bufs.set(k, b); }
      for (let py = 0; py < TILE; py++) {
        const ly = Math.min(LH - 1, y * TILE + py);
        if (ly < r.y0 || ly >= r.y0 + info.height) continue;
        for (let px = 0; px < TILE; px++) {
          const lx = Math.min(LW - 1, x * TILE + px);
          if (lx < r.x0 || lx >= r.x0 + info.width) continue;
          const si = ((ly - r.y0) * info.width + (lx - r.x0)) * 3, di = (py * TILE + px) * 3;
          b[di] = data[si]; b[di + 1] = data[si + 1]; b[di + 2] = data[si + 2];
        }
      }
      const left = need.get(k)! - 1;
      need.set(k, left);
      if (left === 0) { fs.writeFileSync(rawPath(z, x, y), b); bufs.delete(k); }
    }
    console.log(`  source x${col} y${row}: ${keys.length} tiles (${Date.now() - t0} ms)`);
  }

  // crack removal with context from neighboring raw tiles
  const pad = L.crackRad * 4 + 4;
  const RW = TILE + 2 * pad;
  ensureDir(path.dirname(targetPath(z, 0, 0)));
  let done = 0;
  const rawCache = new Map<string, Buffer | null>();
  const loadRaw = (x: number, y: number) => {
    const k = `${x}_${y}`;
    if (!rawCache.has(k)) {
      if (rawCache.size > 200) rawCache.delete(rawCache.keys().next().value!);
      rawCache.set(k, targets.has(k) && fs.existsSync(rawPath(z, x, y)) ? fs.readFileSync(rawPath(z, x, y)) : null);
    }
    return rawCache.get(k);
  };
  const sorted = [...targets].map((k) => k.split('_').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of sorted) {
    const own = loadRaw(x, y);
    const reg = new Uint8Array(RW * RW * 3);
    for (let ry = 0; ry < RW; ry++) {
      for (let rx = 0; rx < RW; rx++) {
        let gx = x * TILE + rx - pad, gy = y * TILE + ry - pad;
        let tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
        let src = loadRaw(tx, ty);
        if (!src) { // outside prepared tiles: replicate the own tile's edge
          src = own!;
          gx = Math.max(x * TILE, Math.min(x * TILE + TILE - 1, gx));
          gy = Math.max(y * TILE, Math.min(y * TILE + TILE - 1, gy));
          tx = x; ty = y;
        }
        const si = ((gy - ty * TILE) * TILE + (gx - tx * TILE)) * 3, di = (ry * RW + rx) * 3;
        reg[di] = src[si]; reg[di + 1] = src[si + 1]; reg[di + 2] = src[si + 2];
      }
    }
    const clean = DECRACK ? decrack(reg, RW, RW, L.crackRad) : reg;
    const out = Buffer.alloc(TILE * TILE * 3);
    for (let py = 0; py < TILE; py++) Buffer.from(clean.buffer).copy(out, py * TILE * 3, ((py + pad) * RW + pad) * 3, ((py + pad) * RW + pad + TILE) * 3);
    fs.writeFileSync(targetPath(z, x, y), out);
    if (++done % 200 === 0) process.stdout.write(`\r  decrack ${done}/${targets.size}`);
  }
  console.log(`\r  decrack ${done}/${targets.size}`);
  plan[z] = { circles, paint: [...paint].map((k) => k.split('_').map(Number) as [number, number]) };
  fs.writeFileSync(path.join(WORK, 'deep-plan.json'), JSON.stringify(plan));
}
