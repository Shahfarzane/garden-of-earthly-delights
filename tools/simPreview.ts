// Assemble simulated tiles and target tiles of one level into side-by-side PNGs.
// Usage: node tools/simPreview.ts z x0 y0 x1 y1 (normalized region) out.png
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { TILE, levelSize, targetPath, WORK } from './common.ts';

const [z, nx0, ny0, nx1, ny1] = process.argv.slice(2, 7).map(Number);
const out = process.argv[7] || path.join(WORK, 'preview', `sim_z${z}.png`);
const { w, h } = levelSize(z);
const tx0 = Math.floor(nx0 * w / TILE), tx1 = Math.floor(nx1 * w / TILE);
const ty0 = Math.floor(ny0 * h / TILE), ty1 = Math.floor(ny1 * h / TILE);
const cw = (tx1 - tx0 + 1) * TILE, ch = (ty1 - ty0 + 1) * TILE;
const img = Buffer.alloc(cw * 2 * ch * 3);
for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
  const sp = path.join(WORK, 'sim', String(z), `${tx}_${ty}.rgb`);
  const sim = fs.existsSync(sp) ? fs.readFileSync(sp) : null;
  const tgt = fs.readFileSync(targetPath(z, tx, ty));
  for (let y = 0; y < TILE; y++) {
    const oy = (ty - ty0) * TILE + y;
    for (let x = 0; x < TILE; x++) {
      const ox = (tx - tx0) * TILE + x;
      const i = (y * TILE + x) * 3;
      const a = (oy * cw * 2 + ox) * 3, b = (oy * cw * 2 + cw + ox) * 3;
      if (sim) { img[a] = sim[i]; img[a + 1] = sim[i + 1]; img[a + 2] = sim[i + 2]; }
      img[b] = tgt[i]; img[b + 1] = tgt[i + 1]; img[b + 2] = tgt[i + 2];
    }
  }
}
await sharp(img, { raw: { width: cw * 2, height: ch, channels: 3 } }).png().toFile(out);
console.log(out, cw * 2, ch);
