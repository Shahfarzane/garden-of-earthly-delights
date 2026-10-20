// CPU twin of the WebGL stroke painter. Same footprint, same blend ("over" in sRGB).
import { coverageLocal, strokeExtent } from '../src/shared/strokeModel.ts';
import type { Stroke } from '../src/shared/strokeModel.ts';

// Paint one stroke onto a float RGB canvas (values 0..255).
// s is in its native level px; (ox, oy) maps native coords to canvas px:
// canvasX = (s.cx - ox) * scale.
export function paintStroke(canvas: Float32Array, W: number, H: number, s: Stroke, ox: number, oy: number, scale: number): void {
  const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
  const cx = (s.cx - ox) * scale, cy = (s.cy - oy) * scale;
  const e = strokeExtent(s, scale);
  // bounding box of the oriented box in canvas px
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const lx of [e.x0, e.x1]) for (const ly of [e.y0, e.y1]) {
    const px = cx + (lx * ca - ly * sa) * scale;
    const py = cy + (lx * sa + ly * ca) * scale;
    if (px < minx) minx = px; if (px > maxx) maxx = px;
    if (py < miny) miny = py; if (py > maxy) maxy = py;
  }
  const x0 = Math.max(0, Math.floor(minx)), x1 = Math.min(W - 1, Math.ceil(maxx));
  const y0 = Math.max(0, Math.floor(miny)), y1 = Math.min(H - 1, Math.ceil(maxy));
  if (x0 > x1 || y0 > y1) return;
  const inv = 1 / scale;
  const a0 = s.alpha;
  const r = s.r, g = s.g, b = s.b;
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) * inv;
    let idx = (y * W + x0) * 3;
    for (let x = x0; x <= x1; x++, idx += 3) {
      const dx = (x + 0.5 - cx) * inv;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      if (lx < e.x0 || lx > e.x1 || ly < e.y0 || ly > e.y1) continue;
      const cov = coverageLocal(lx, ly, s, scale);
      if (cov <= 0) continue;
      const a = cov * a0;
      canvas[idx] += (r - canvas[idx]) * a;
      canvas[idx + 1] += (g - canvas[idx + 1]) * a;
      canvas[idx + 2] += (b - canvas[idx + 2]) * a;
    }
  }
}
