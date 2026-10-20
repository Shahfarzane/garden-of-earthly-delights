// Effects map: where the painting moves. RGBA at 1/64 world scale:
//   R water (1 = open water, ~0.5 = ice / dark hell water), G fire glow, B foliage sway, A sky.
// Color predicates are applied only inside regions traced by hand on the painting
// (normalized triptych coords, read off gridded crops), so blue fruit or pink flesh never ripple.
import sharp from 'sharp';
import path from 'node:path';
import { WORK, OUT, ensureDir } from './common.ts';

const src = path.join(WORK, 'preview', 'target_z4.png');
const { data: full, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
// work at half of z4: 64 world px per texel
const W = Math.ceil(info.width / 2), H = Math.ceil(info.height / 2);
const img = new Float32Array(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
  let s = 0, n = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const sx = Math.min(info.width - 1, 2 * x + dx), sy = Math.min(info.height - 1, 2 * y + dy);
    s += full[(sy * info.width + sx) * info.channels + c]; n++;
  }
  img[(y * W + x) * 3 + c] = s / n;
}

function boxBlur(a: Float32Array, C: number, r: number): Float32Array {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < C; c++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= W) continue; s += a[(y * W + xx) * C + c]; n++; }
    t[(y * W + x) * C + c] = s / n;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < C; c++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= H) continue; s += t[(yy * W + x) * C + c]; n++; }
    o[(y * W + x) * C + c] = s / n;
  }
  return o;
}
const lum = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) lum[i] = 0.299 * img[i * 3] + 0.587 * img[i * 3 + 1] + 0.114 * img[i * 3 + 2];
const mean = boxBlur(lum, 1, 3);
const sq = boxBlur(lum.map((v) => v * v), 1, 2);
const mean2 = boxBlur(lum, 1, 2);
const wideMean = boxBlur(lum, 1, 10);

const inPoly = (x: number, y: number, poly: readonly number[][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inEllipse = (x: number, y: number, [cx, cy, rx, ry]: readonly number[]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const rect = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// ---- regions (normalized triptych coordinates) ----
const WATER = [
  { poly: rect(0.005, 0.365, 0.06, 0.44), kind: 'blue' }, // Eden: upper-left pond with egrets
  { poly: [[0.01, 0.445], [0.22, 0.44], [0.228, 0.585], [0.01, 0.585]], kind: 'grey' }, // Eden: lake around the Fountain of Life
  { poly: [[0.06, 0.885], [0.235, 0.872], [0.238, 0.978], [0.06, 0.978]], kind: 'dark' }, // Eden: dark pool of reptiles
  { poly: [[0.25, 0.215], [0.75, 0.215], [0.752, 0.338], [0.25, 0.338]], kind: 'blue', not: [[0.505, 0.286, 0.042, 0.06], [0.69, 0.272, 0.05, 0.07]] }, // Garden: lake and rivers
  { ellipse: [0.505, 0.446, 0.07, 0.026], kind: 'pool' }, // Garden: Pool of Youth
  { poly: [[0.245, 0.6], [0.46, 0.6], [0.472, 0.745], [0.245, 0.745]], kind: 'grey' }, // Garden: lower-left lake of bathers
  { poly: [[0.86, 0.525], [0.995, 0.525], [0.995, 0.615], [0.93, 0.615], [0.88, 0.6], [0.86, 0.585]], kind: 'ice' }, // Hell: frozen lake of the skaters
  { poly: rect(0.835, 0.49, 0.905, 0.53), kind: 'ice' }, // Hell: dark water around the tree man's boat
];
const FIRE = [
  { poly: rect(0.765, 0.0, 0.998, 0.265) }, // Hell: burning city and sky
  { poly: rect(0.765, 0.265, 0.80, 0.34) }, // fire by the ear
  { ellipse: [0.958, 0.39, 0.012, 0.03] }, // lantern
  { ellipse: [0.865, 0.395, 0.03, 0.03] }, // tavern inside the tree man
];
const FOLIAGE = [
  rect(0.0, 0.53, 0.078, 0.83), // dragon tree
  rect(0.0, 0.56, 0.24, 0.668), // Eden forest band
  rect(0.192, 0.3, 0.242, 0.44), // palm
  rect(0.01, 0.23, 0.24, 0.37), // Eden meadow trees
  rect(0.0, 0.135, 0.243, 0.205), // Eden horizon trees
  rect(0.245, 0.165, 0.755, 0.24), // Garden hedges at the horizon
  rect(0.245, 0.42, 0.33, 0.5), // Garden left bushes
  rect(0.675, 0.43, 0.755, 0.64), // Garden right trees
];
const SKY = [
  { poly: rect(0.005, 0.004, 0.243, 0.165), night: false },
  { poly: rect(0.245, 0.004, 0.755, 0.17), night: false },
  { poly: rect(0.765, 0.004, 0.996, 0.26), night: true },
];

const out = new Uint8Array(W * H * 4);
const m = { water: new Float32Array(W * H), fire: new Float32Array(W * H), fol: new Float32Array(W * H), sky: new Float32Array(W * H) };
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const i = py * W + px;
    const x = (px + 0.5) / W, y = (py + 0.5) / H;
    const r = img[i * 3], g = img[i * 3 + 1], b = img[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const v = mx / 255, s = mx > 0 ? (mx - mn) / mx : 0;
    const L = lum[i];
    const variance = Math.max(0, sq[i] - mean2[i] * mean2[i]);
    const std = Math.sqrt(variance);
    for (const wr of WATER) {
      const inside = wr.poly ? inPoly(x, y, wr.poly) : inEllipse(x, y, wr.ellipse);
      if (!inside || (wr.not && wr.not.some((e) => inEllipse(x, y, e)))) continue;
      let val = 0;
      if (wr.kind === 'blue') val = b > r + 12 && b >= g - 12 && v > 0.32 ? 1 : 0;
      else if (wr.kind === 'grey') val = (b > r + 3 && s < 0.5 && v > 0.28 && v < 0.88) || (b > r + 12 && b >= g - 12 && v > 0.32) ? 1 : 0;
      else if (wr.kind === 'pool') val = b >= r - 5 && v < 0.6 ? 1 : 0;
      else if (wr.kind === 'dark') val = v < 0.3 && s < 0.6 ? 1 : 0;
      else if (wr.kind === 'ice') val = v < 0.4 && v > 0.05 && b >= r - 2 && s < 0.6 ? 0.5 : 0;
      m.water[i] = Math.max(m.water[i], val);
    }
    for (const fr of FIRE) {
      const inside = fr.poly ? inPoly(x, y, fr.poly) : inEllipse(x, y, fr.ellipse);
      if (!inside) continue;
      const warm = r > 110 && r > g + 18 && g >= b - 5 && r > b + 45;
      const emissive = L - wideMean[i];
      if (warm && emissive > 12) m.fire[i] = Math.max(m.fire[i], Math.min(1, (emissive - 12) / 50 + (r > 200 ? 0.3 : 0)));
    }
    for (const fp of FOLIAGE) {
      if (!inPoly(x, y, fp)) continue;
      const green = g > r + 4 && g > b + 10 && s > 0.25 && v < 0.55;
      if (green && std > 3) m.fol[i] = Math.max(m.fol[i], Math.min(1, (std - 3) / 8));
    }
    for (const sr of SKY) {
      if (!inPoly(x, y, sr.poly)) continue;
      if (!sr.night) {
        const pale = v > 0.5 && (s < 0.35 || (b > r + 10 && v > 0.55)) && std < 9;
        if (pale) m.sky[i] = 1;
      } else if (v < 0.35 && std < 14) m.sky[i] = 0.5;
    }
  }
}
// clean speckle (open = erode then dilate on a 3x3), then feather
function open3(a: Float32Array): Float32Array {
  const e = new Float32Array(a.length), d = new Float32Array(a.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let mn = Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy)); mn = Math.min(mn, a[yy * W + xx]); }
    e[y * W + x] = mn;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let mx = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy)); mx = Math.max(mx, e[yy * W + xx]); }
    d[y * W + x] = mx;
  }
  return d;
}
const water = boxBlur(open3(m.water), 1, 1);
const fire = boxBlur(m.fire, 1, 1);
const fol = boxBlur(boxBlur(m.fol, 1, 2), 1, 2).map((v) => Math.min(1, v * 1.6));
const sky = boxBlur(open3(m.sky), 1, 2);
for (let i = 0; i < W * H; i++) {
  out[i * 4] = Math.round(Math.min(1, water[i]) * 255);
  out[i * 4 + 1] = Math.round(Math.min(1, fire[i]) * 255);
  out[i * 4 + 2] = Math.round(Math.min(1, fol[i]) * 255);
  out[i * 4 + 3] = Math.round(Math.min(1, sky[i]) * 255);
}
ensureDir(OUT);
await sharp(Buffer.from(out), { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'effects.png'));
// preview: each mask tinted over a darkened painting
const prev = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const base = [img[i * 3] * 0.45, img[i * 3 + 1] * 0.45, img[i * 3 + 2] * 0.45];
  const wv = out[i * 4] / 255, fv = out[i * 4 + 1] / 255, gv = out[i * 4 + 2] / 255, sv = out[i * 4 + 3] / 255;
  prev[i * 3] = Math.min(255, base[0] + fv * 255 + sv * 90);
  prev[i * 3 + 1] = Math.min(255, base[1] + wv * 120 + gv * 200 + sv * 90 + fv * 120);
  prev[i * 3 + 2] = Math.min(255, base[2] + wv * 255 + sv * 90);
}
await sharp(prev, { raw: { width: W, height: H, channels: 3 } }).resize({ width: 2000 }).jpeg({ quality: 85 }).toFile(path.join(WORK, 'preview', 'effects_preview.jpg'));
console.log(`effects ${W}x${H}`);
