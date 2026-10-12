// Decode the 18 source tiles at 1/8 (JPEG shrink-on-load), stitch level 6,
// then cut 256 px raw RGB target tiles for levels 0..6.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { decrack } from './decrack.js';
import { cutTiles, halve } from './pyramid.js';
import {
  WORK, SOURCE_DIR, FULL_Z, TILE, SRC_COLS, SRC_ROWS,
  levelSize, levelTiles, targetPath, ensureDir,
} from './common.js';

sharp.cache(false);
sharp.concurrency(4);

const z = FULL_Z;
const shrink = 8;
const { w: W6, h: H6 } = levelSize(z);
console.log(`level ${z}: ${W6} x ${H6}`);
const img = Buffer.alloc(W6 * H6 * 3);

for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 6; col++) {
    const file = path.join(SOURCE_DIR, `tile-x${col}-y${row}.jpg`);
    const t0 = Date.now();
    const meta = await sharp(file, { limitInputPixels: false }).metadata();
    const tw = Math.round(meta.width / shrink);
    const th = Math.round(meta.height / shrink);
    const { data, info } = await sharp(file, { limitInputPixels: false, sequentialRead: true })
      .resize(tw, th, { fit: 'fill', kernel: 'lanczos3' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ox = Math.round(SRC_COLS[col] / shrink);
    const oy = Math.round(SRC_ROWS[row] / shrink);
    for (let y = 0; y < info.height; y++) {
      const dy = oy + y;
      if (dy >= H6) break;
      const n = Math.min(info.width, W6 - ox);
      data.copy(img, (dy * W6 + ox) * 3, y * info.width * 3, (y * info.width + n) * 3);
    }
    console.log(`  x${col} y${row}: ${info.width}x${info.height} at ${ox},${oy} (${Date.now() - t0} ms)`);
  }
}

// Craquelure removal on the stitched level, in overlapping strips to bound memory.
function decrackImage(buf, W, H, rad) {
  const out = Buffer.alloc(buf.length);
  const strip = 512, pad = rad * 4 + 4;
  for (let y0 = 0; y0 < H; y0 += strip) {
    const a = Math.max(0, y0 - pad), b = Math.min(H, y0 + strip + pad);
    const part = new Uint8Array(buf.buffer, buf.byteOffset + a * W * 3, (b - a) * W * 3);
    const res = decrack(part, W, b - a, rad);
    const rows = Math.min(strip, H - y0);
    Buffer.from(res.buffer).copy(out, y0 * W * 3, (y0 - a) * W * 3, (y0 - a + rows) * W * 3);
    process.stdout.write(`\r  decrack ${Math.min(H, y0 + strip)}/${H}`);
  }
  console.log();
  return out;
}

ensureDir(path.join(WORK, 'preview'));
let cur = { buf: decrackImage(img, W6, H6, 2), w: W6, h: H6 };
for (let level = z; level >= 0; level--) {
  if (level < z) cur = halve(cur.buf, cur.w, cur.h);
  const exp = levelSize(level);
  if (cur.w !== exp.w || cur.h !== exp.h) console.warn(`  size mismatch at ${level}: ${cur.w}x${cur.h} vs ${exp.w}x${exp.h}`);
  const { nx, ny } = cutTiles(level, cur.buf, cur.w, cur.h);
  console.log(`  level ${level}: ${nx}x${ny} tiles`);
  if (level <= 4) {
    ensureDir(path.join(WORK, 'preview'));
    await sharp(cur.buf, { raw: { width: cur.w, height: cur.h, channels: 3 } })
      .png().toFile(path.join(WORK, 'preview', `target_z${level}.png`));
  }
}
console.log('done');
