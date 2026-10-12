// Level pyramid helpers shared by the interior and exterior preparation.
import fs from 'node:fs';
import path from 'node:path';
import { TILE, levelTiles, targetPath, ensureDir } from './common.js';

// Cut a level image into 256 px raw RGB tiles, replicating edges past the image.
export function cutTiles(level, buf, w, h) {
  const { nx, ny } = levelTiles(level);
  ensureDir(path.dirname(targetPath(level, 0, 0)));
  const tile = Buffer.alloc(TILE * TILE * 3);
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      for (let y = 0; y < TILE; y++) {
        const sy = Math.min(h - 1, ty * TILE + y);
        for (let x = 0; x < TILE; x++) {
          const sx = Math.min(w - 1, tx * TILE + x);
          const si = (sy * w + sx) * 3, di = (y * TILE + x) * 3;
          tile[di] = buf[si]; tile[di + 1] = buf[si + 1]; tile[di + 2] = buf[si + 2];
        }
      }
      fs.writeFileSync(targetPath(level, tx, ty), tile);
    }
  }
  return { nx, ny };
}

// 2x box reduction, odd edges replicate.
export function halve(buf, w, h) {
  const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2);
  const out = Buffer.alloc(w2 * h2 * 3);
  for (let y = 0; y < h2; y++) {
    const y0 = Math.min(h - 1, 2 * y), y1 = Math.min(h - 1, 2 * y + 1);
    for (let x = 0; x < w2; x++) {
      const x0 = Math.min(w - 1, 2 * x), x1 = Math.min(w - 1, 2 * x + 1);
      for (let c = 0; c < 3; c++) {
        out[(y * w2 + x) * 3 + c] = (buf[(y0 * w + x0) * 3 + c] + buf[(y0 * w + x1) * 3 + c] +
          buf[(y1 * w + x0) * 3 + c] + buf[(y1 * w + x1) * 3 + c] + 2) >> 2;
      }
    }
  }
  return { buf: out, w: w2, h: h2 };
}
