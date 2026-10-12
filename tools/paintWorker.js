import { parentPort } from 'node:worker_threads';
import { paintTile } from './paintTile.js';

import { TILE } from './common.js';
import { M } from './paintTile.js';

// Hotspot weight: 1 inside 82% of the radius, fading to 0 at the edge.
function weightMap(z, x, y, circles) {
  const W = TILE + 2 * M;
  const rx = x * TILE - M, ry = y * TILE - M;
  const near = circles.filter((c) => c.x + c.r > rx && c.x - c.r < rx + W && c.y + c.r > ry && c.y - c.r < ry + W);
  const w = new Float32Array(W * W);
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    let best = 0;
    for (const c of near) {
      const d = Math.hypot(rx + px - c.x, ry + py - c.y);
      const t = Math.max(0, Math.min(1, (c.r - d) / (0.18 * c.r)));
      if (t > best) best = t;
    }
    w[py * W + px] = best;
  }
  return w;
}

parentPort.on('message', ({ z, x, y, sim, circles }) => {
  const weight = circles ? weightMap(z, x, y, circles) : null;
  const r = paintTile(z, x, y, { sim, weight, skipEmpty: !!circles });
  parentPort.postMessage(r);
});
