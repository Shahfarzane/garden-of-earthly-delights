// Paint one tile: re-render ancestors, then add layered strokes where the copy differs.
import fs from 'node:fs';
import path from 'node:path';
import {
  TILE, levelSize, levelTiles, targetPath, strokePath, ensureDir, WORK,
} from './common.js';
import { encodeStrokes, decodeStroke, RECORD_BYTES, quantize } from '../src/shared/strokeModel.js';
import { paintStroke } from './raster.js';

export const GROUND = [214, 200, 168]; // chalk ground with a warm imprimatura
export const M = 48; // work margin around the tile, level px
export const STROKE_REACH = 40; // max distance a stroke extends past its tile, level px

// Brush plan per level: radii in level px with their error thresholds.
export function brushPlan(z) {
  if (process.env.PLAN) { const p = JSON.parse(process.env.PLAN); return p[z] || p.d; }
  if (z === 0) return [[16, 10], [8, 10], [4, 12], [2, 14], [1.25, 16]];
  return [[4, 16], [2, 18], [1.25, 22]];
}

// ---------- caches ----------
const targetCache = new Map();
function loadTarget(z, x, y) {
  const key = `${z}/${x}_${y}`;
  let t = targetCache.get(key);
  if (!t) {
    t = fs.readFileSync(targetPath(z, x, y));
    if (targetCache.size > 64) targetCache.delete(targetCache.keys().next().value);
    targetCache.set(key, t);
  }
  return t;
}
const strokeCache = new Map();
export function loadStrokes(z, x, y) {
  const key = `${z}/${x}_${y}`;
  let s = strokeCache.get(key);
  if (s === undefined) {
    const p = strokePath(z, x, y);
    if (!fs.existsSync(p)) s = null;
    else {
      const buf = fs.readFileSync(p);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const n = buf.byteLength / RECORD_BYTES;
      s = new Array(n);
      for (let i = 0; i < n; i++) s[i] = decodeStroke(dv, i, x * TILE, y * TILE);
    }
    if (strokeCache.size > 256) strokeCache.delete(strokeCache.keys().next().value);
    strokeCache.set(key, s);
  }
  return s;
}

// Region of level z, origin (rx, ry), size rw x rh, clamped to the level bounds.
function loadTargetRegion(z, rx, ry, rw, rh) {
  const { w, h } = levelSize(z);
  const out = new Float32Array(rw * rh * 3);
  for (let y = 0; y < rh; y++) {
    const sy = Math.max(0, Math.min(h - 1, ry + y));
    const ty = Math.floor(sy / TILE), py = sy - ty * TILE;
    for (let x = 0; x < rw; x++) {
      const sx = Math.max(0, Math.min(w - 1, rx + x));
      const tx = Math.floor(sx / TILE), px = sx - tx * TILE;
      const t = loadTarget(z, tx, ty);
      const si = (py * TILE + px) * 3, di = (y * rw + x) * 3;
      out[di] = t[si]; out[di + 1] = t[si + 1]; out[di + 2] = t[si + 2];
    }
  }
  return out;
}

// Paint every stored stroke of levels < z that touches the region, in the order the browser uses.
export function renderAncestors(canvas, z, rx, ry, rw, rh, opts = {}) {
  const fromZ = opts.fromZ ?? 0;
  for (let za = fromZ; za < z; za++) {
    const scale = Math.pow(2, z - za);
    const { nx, ny } = levelTiles(za);
    const ax0 = rx / scale - STROKE_REACH, ay0 = ry / scale - STROKE_REACH;
    const ax1 = (rx + rw) / scale + STROKE_REACH, ay1 = (ry + rh) / scale + STROKE_REACH;
    // level-0 strokes can reach ~85 px past their tile, so every z0 file is used (as in src/engine/tiles.js)
    const fx0 = za === 0 ? 0 : Math.max(0, Math.floor(ax0 / TILE)), fx1 = za === 0 ? nx - 1 : Math.min(nx - 1, Math.floor(ax1 / TILE));
    const fy0 = za === 0 ? 0 : Math.max(0, Math.floor(ay0 / TILE)), fy1 = za === 0 ? ny - 1 : Math.min(ny - 1, Math.floor(ay1 / TILE));
    for (let fy = fy0; fy <= fy1; fy++) {
      for (let fx = fx0; fx <= fx1; fx++) {
        const strokes = loadStrokes(za, fx, fy);
        if (!strokes) continue;
        for (const s of strokes) paintStroke(canvas, rw, rh, s, rx / scale, ry / scale, scale);
      }
    }
  }
}

// ---------- image helpers ----------
function gaussKernel(sigma) {
  const rad = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(2 * rad + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + rad]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, rad };
}
function blur(src, W, H, C, sigma) {
  if (sigma < 0.3) return src.slice();
  const { k, rad } = gaussKernel(sigma);
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < C; c++) {
    let acc = 0;
    for (let i = -rad; i <= rad; i++) {
      const xx = Math.max(0, Math.min(W - 1, x + i));
      acc += src[(y * W + xx) * C + c] * k[i + rad];
    }
    tmp[(y * W + x) * C + c] = acc;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < C; c++) {
    let acc = 0;
    for (let i = -rad; i <= rad; i++) {
      const yy = Math.max(0, Math.min(H - 1, y + i));
      acc += tmp[(yy * W + x) * C + c] * k[i + rad];
    }
    out[(y * W + x) * C + c] = acc;
  }
  return out;
}

// Edge-tangent field from the smoothed structure tensor of luminance.
function tangentField(ref, W, H, sigma) {
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.299 * ref[i * 3] + 0.587 * ref[i * 3 + 1] + 0.114 * ref[i * 3 + 2];
  const J = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
    const gx = (lum[ym * W + xp] + 2 * lum[y * W + xp] + lum[yp * W + xp]) - (lum[ym * W + xm] + 2 * lum[y * W + xm] + lum[yp * W + xm]);
    const gy = (lum[yp * W + xm] + 2 * lum[yp * W + x] + lum[yp * W + xp]) - (lum[ym * W + xm] + 2 * lum[ym * W + x] + lum[ym * W + xp]);
    const i = (y * W + x) * 3;
    J[i] = gx * gx; J[i + 1] = gx * gy; J[i + 2] = gy * gy;
  }
  const Js = blur(J, W, H, 3, sigma);
  const ang = new Float32Array(W * H);
  const coh = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = Js[i * 3], b = Js[i * 3 + 1], c = Js[i * 3 + 2];
    // gradient direction = major eigenvector; tangent is perpendicular
    ang[i] = 0.5 * Math.atan2(2 * b, a - c) + Math.PI / 2;
    const tr = a + c, det = Math.sqrt((a - c) * (a - c) + 4 * b * b);
    coh[i] = tr > 1e-3 ? det / tr : 0;
  }
  return { ang, coh };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist3(a, i, b, j) {
  const d0 = a[i] - b[j], d1 = a[i + 1] - b[j + 1], d2 = a[i + 2] - b[j + 2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}
function distC(a, i, c) {
  const d0 = a[i] - c[0], d1 = a[i + 1] - c[1], d2 = a[i + 2] - c[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

// Trace a stroke both ways along the edge tangent from (x0, y0); returns polyline points.
function trace(x0, y0, R, ref, canvas, field, W, H, color, maxSide) {
  const pts = [[x0, y0]];
  for (const dirSign of [1, -1]) {
    let x = x0, y = y0;
    let a0 = field.ang[(Math.round(y0) * W + Math.round(x0))];
    let ldx = Math.cos(a0) * dirSign, ldy = Math.sin(a0) * dirSign;
    for (let i = 0; i < maxSide; i++) {
      const ix = Math.round(x + ldx * R), iy = Math.round(y + ldy * R);
      if (ix < 1 || iy < 1 || ix >= W - 1 || iy >= H - 1) break;
      const pi = iy * W + ix;
      const a = field.ang[pi];
      let dx = Math.cos(a), dy = Math.sin(a);
      if (dx * ldx + dy * ldy < 0) { dx = -dx; dy = -dy; }
      // limit turning so the arc fit stays honest
      const nx = 0.6 * dx + 0.4 * ldx, ny = 0.6 * dy + 0.4 * ldy;
      const nl = Math.hypot(nx, ny) || 1;
      const sx = x + (nx / nl) * R, sy = y + (ny / nl) * R;
      const jx = Math.round(sx), jy = Math.round(sy);
      if (jx < 1 || jy < 1 || jx >= W - 1 || jy >= H - 1) break;
      const j = (jy * W + jx) * 3;
      const dRef = distC(ref, j, color);
      if (dRef > STOP_DIFF) break; // color changes: the stroke ends here
      if (dist3(ref, j, canvas, j) < dRef) break; // already painted well enough
      x = sx; y = sy; ldx = nx / nl; ldy = ny / nl;
      if (dirSign === 1) pts.push([x, y]); else pts.unshift([x, y]);
    }
  }
  return pts;
}

function fitArc(pts, field, W) {
  if (pts.length === 1) {
    const [x, y] = pts[0];
    return { cx: x, cy: y, angle: field.ang[Math.round(y) * W + Math.round(x)], len: 0, bend: 0 };
  }
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const l = Math.hypot(dx, dy);
    segs.push({ l, a: Math.atan2(dy, dx) });
    total += l;
  }
  let bend = 0;
  for (let i = 1; i < segs.length; i++) {
    let d = segs[i].a - segs[i - 1].a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    bend += d;
  }
  bend = Math.max(-Math.PI * 0.9, Math.min(Math.PI * 0.9, bend));
  // center = the point at half length
  let acc = 0, cx = pts[0][0], cy = pts[0][1], ang = segs[0].a;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i].l >= total / 2) {
      const t = (total / 2 - acc) / (segs[i].l || 1);
      cx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      cy = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      ang = segs[i].a;
      break;
    }
    acc += segs[i].l;
  }
  // a polyline's chord-based center sits inside the arc; nudge the tangent to the mean direction
  const k = total > 1e-4 ? bend / total : 0;
  // the arc model is symmetric around its center, so the tangent there is the average direction
  const meanA = Math.atan2(pts[pts.length - 1][1] - pts[0][1], pts[pts.length - 1][0] - pts[0][0]);
  void k;
  return { cx, cy, angle: meanA, len: total, bend };
}

function psnr(a, b, W, H, x0, y0, x1, y1) {
  let se = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; se += d * d; n++; }
  }
  const mse = se / n;
  return mse < 1e-9 ? 99 : 10 * Math.log10(255 * 255 / mse);
}

const GRID_K = Number(process.env.GRID_K || 1.5);
const MASK_A0 = Number(process.env.MASK_A0 || 30);
const STOP_DIFF = Number(process.env.STOP_DIFF || 34);
const TAU_LOW = Number(process.env.TAU_LOW || 7);

// Local contrast energy: mean |target - blur(target)| around each pixel.
function activity(target, W, H, R) {
  const b = blur(target, W, H, 3, Math.max(1, R));
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = dist3(target, i * 3, b, i * 3);
  return blur(d, W, H, 1, Math.max(1.5, R * 1.5));
}

// ---------- main entry ----------
export function paintTile(z, tx, ty, opts = {}) {
  const rx = tx * TILE - M, ry = ty * TILE - M;
  const W = TILE + 2 * M, H = TILE + 2 * M;
  const target = loadTargetRegion(z, rx, ry, W, H);
  const canvas = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { canvas[i * 3] = GROUND[0]; canvas[i * 3 + 1] = GROUND[1]; canvas[i * 3 + 2] = GROUND[2]; }
  renderAncestors(canvas, z, rx, ry, W, H);
  const before = psnr(canvas, target, W, H, M, M, M + TILE, M + TILE);

  const rand = mulberry32((z * 73856093) ^ (tx * 19349663) ^ (ty * 83492791));
  const weight = opts.weight || null; // optional per-pixel 0..1 mask (hotspot falloff)
  const all = [];
  const plan = opts.plan || brushPlan(z);
  for (const [R, tau] of plan) {
    const ref = blur(target, W, H, 3, Math.max(0, R * 0.5 - 0.25));
    const field = tangentField(ref, W, H, Math.max(1, R));
    const err = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) err[i] = dist3(ref, i * 3, canvas, i * 3);
    // low-frequency color error: never masked
    const sl = Math.max(1.5, 2 * R);
    const refL = blur(target, W, H, 3, sl), canL = blur(canvas, W, H, 3, sl);
    const errL = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) errL[i] = dist3(refL, i * 3, canL, i * 3);
    const g = Math.max(1, Math.ceil(R * GRID_K));
    // texture masking: busy areas hide error, smooth areas reveal it
    const act = activity(target, W, H, R);
    const layer = [];
    for (let gy = M; gy < M + TILE; gy += g) {
      for (let gx = M; gx < M + TILE; gx += g) {
        let sum = 0, sumL = 0, n = 0, best = -1, bx = gx, by = gy;
        for (let y = gy; y < Math.min(gy + g, M + TILE); y++) for (let x = gx; x < Math.min(gx + g, M + TILE); x++) {
          const e = err[y * W + x];
          sum += e; sumL += errL[y * W + x]; n++;
          if (e > best) { best = e; bx = x; by = y; }
        }
        let thr = tau * (1 + act[by * W + bx] / MASK_A0);
        let thrL = TAU_LOW;
        if (weight) { const wv = weight[by * W + bx]; if (wv <= 0.01) continue; thr /= wv; thrL /= wv; }
        if (sum / n <= thr && sumL / n <= thrL) continue;
        const ci = (by * W + bx) * 3;
        const color = [ref[ci], ref[ci + 1], ref[ci + 2]];
        const maxSide = R >= 4 ? 4 : R >= 2 ? 5 : 6;
        const pts = trace(bx + 0.5, by + 0.5, R, ref, canvas, field, W, H, color, maxSide);
        // average color along the path (on the sharper target for small brushes)
        const src = R <= 1.25 ? target : ref;
        let cr = 0, cg = 0, cb = 0;
        for (const [px, py] of pts) {
          const j = (Math.round(py) * W + Math.round(px)) * 3;
          cr += src[j]; cg += src[j + 1]; cb += src[j + 2];
        }
        const arc = fitArc(pts, field, W);
        const s = quantize({
          ...arc,
          width: 2 * R * (0.9 + 0.2 * rand()),
          r: Math.round(cr / pts.length), g: Math.round(cg / pts.length), b: Math.round(cb / pts.length),
          alpha: 1,
          seed: Math.floor(rand() * 16),
        });
        // back to work-area coordinates (quantize kept them; they are already in work coords)
        layer.push(s);
      }
    }
    // shuffle, then paint the layer
    for (let i = layer.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [layer[i], layer[j]] = [layer[j], layer[i]]; }
    for (const s of layer) paintStroke(canvas, W, H, s, 0, 0, 1);
    for (const s of layer) all.push(s);
  }
  const after = psnr(canvas, target, W, H, M, M, M + TILE, M + TILE);
  const afterB = psnr(blur(canvas, W, H, 3, 1.2), blur(target, W, H, 3, 1.2), W, H, M, M, M + TILE, M + TILE);

  // store in tile-local coords of level z: work coords -> level coords is +rx/+ry
  const level = all.map((s) => ({ ...s, cx: s.cx + rx, cy: s.cy + ry }));
  const bytes = encodeStrokes(level, tx * TILE, ty * TILE);
  if (!opts.dry && !(opts.skipEmpty && all.length === 0)) {
    const p = strokePath(z, tx, ty);
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, bytes);
    strokeCache.delete(`${z}/${tx}_${ty}`);
  }
  if (opts.sim) {
    const sp = path.join(WORK, 'sim', String(z), `${tx}_${ty}.rgb`);
    ensureDir(path.dirname(sp));
    const out = Buffer.alloc(TILE * TILE * 3);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) for (let c = 0; c < 3; c++) {
      out[(y * TILE + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(canvas[((y + M) * W + x + M) * 3 + c])));
    }
    fs.writeFileSync(sp, out);
  }
  return { z, tx, ty, strokes: all.length, bytes: bytes.length, before, after, afterB };
}
