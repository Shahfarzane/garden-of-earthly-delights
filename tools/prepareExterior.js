// Closed exterior ("Creation of the World"): crop the two painted areas inside the inner
// gilt lines of the Commons photo, set them side by side, and cut the level pyramid.
// Usage: WORLD=exterior node tools/prepareExterior.js <photo.jpg>
// Source: https://commons.wikimedia.org/wiki/File:El_Bosco_-_Tr%C3%ADptico_del_Jard%C3%ADn_de_las_delicias.jpg
// (1806 x 1920, public domain, sha1 ac1a5f789ae2e611b5dcdaece5a4ceff2b2b5caa)
import sharp from 'sharp';
import path from 'node:path';
import { WORK, WORLD_W, WORLD_H, FULL_Z, levelSize, ensureDir } from './common.js';
import { cutTiles, halve } from './pyramid.js';

if (process.env.WORLD !== 'exterior') throw new Error('run with WORLD=exterior');
const src = process.argv[2];
if (!src) throw new Error('usage: WORLD=exterior node tools/prepareExterior.js <photo.jpg>');

// painted areas measured from the gilt lines (column/row profiles of warm bright pixels)
const LEFT = { left: 104, top: 111, width: 700, height: 1700 };
const RIGHT = { left: 1000, top: 111, width: 702, height: 1700 };
if (LEFT.width + RIGHT.width !== WORLD_W || LEFT.height !== WORLD_H) throw new Error('crop does not match WORLD_W/H');

const left = await sharp(src).extract(LEFT).removeAlpha().raw().toBuffer();
const right = await sharp(src).extract(RIGHT).removeAlpha().raw().toBuffer();
const img = Buffer.alloc(WORLD_W * WORLD_H * 3);
for (let y = 0; y < WORLD_H; y++) {
  left.copy(img, y * WORLD_W * 3, y * LEFT.width * 3, (y + 1) * LEFT.width * 3);
  right.copy(img, (y * WORLD_W + LEFT.width) * 3, y * RIGHT.width * 3, (y + 1) * RIGHT.width * 3);
}
ensureDir(path.join(WORK, 'preview'));
await sharp(img, { raw: { width: WORLD_W, height: WORLD_H, channels: 3 } }).jpeg({ quality: 90 }).toFile(path.join(WORK, 'preview', 'exterior_target.jpg'));
let cur = { buf: img, w: WORLD_W, h: WORLD_H };
for (let level = FULL_Z; level >= 0; level--) {
  if (level < FULL_Z) cur = halve(cur.buf, cur.w, cur.h);
  const exp = levelSize(level);
  if (cur.w !== exp.w || cur.h !== exp.h) console.warn(`size mismatch at ${level}`);
  const { nx, ny } = cutTiles(level, cur.buf, cur.w, cur.h);
  console.log(`  level ${level}: ${cur.w}x${cur.h}, ${nx}x${ny} tiles`);
}
