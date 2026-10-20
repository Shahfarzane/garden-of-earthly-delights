// The brush stroke, shared by the offline analyzer (CPU) and the WebGL painter (GPU).
// Keep footprint() and the GLSL in src/engine/shaders.ts in lockstep: the analyzer
// decides where to add strokes by simulating exactly what the browser will paint.
//
// A stroke is a circular-arc ribbon with round caps, in level-pixel units:
//   cx, cy   center of the arc
//   angle    tangent direction at the center (radians, mod PI)
//   len      centerline arc length (0 = a dab)
//   bend     total turning angle across the stroke (len * curvature), [-PI, PI]
//   width    full width
//   r, g, b  sRGB 0..255
//   alpha    0..1 opacity of the paint load
//   seed     0..255, drives the bristle streaks

export interface Stroke {
  cx: number; cy: number; angle: number; len: number; bend: number; width: number;
  r: number; g: number; b: number; alpha: number; seed: number;
}

// Half-extents of a stroke's padded bounding box in its own frame.
export interface StrokeExtent { x0: number; x1: number; y0: number; y1: number }

export const RECORD_BYTES = 12;
// Stroke centers may sit slightly outside their tile; positions are stored with an offset.
export const POS_OFFSET = 64;
export const POS_SCALE = 128; // 1/128 px precision, covers [-64, 448)

export function widthFromByte(q: number): number { return 0.5 * Math.pow(2, q / 32); }
export function widthToByte(w: number): number { return Math.max(0, Math.min(255, Math.round(32 * Math.log2(w / 0.5)))); }

// Strokes are stored in tile-local coordinates of their level.
export function encodeStrokes(strokes: readonly Stroke[], ox = 0, oy = 0): Uint8Array {
  const buf = new ArrayBuffer(strokes.length * RECORD_BYTES);
  const dv = new DataView(buf);
  let o = 0;
  for (const s of strokes) {
    const qx = Math.round((s.cx - ox + POS_OFFSET) * POS_SCALE);
    const qy = Math.round((s.cy - oy + POS_OFFSET) * POS_SCALE);
    dv.setUint16(o, Math.max(0, Math.min(65535, qx)), true);
    dv.setUint16(o + 2, Math.max(0, Math.min(65535, qy)), true);
    // Angle is stored mod PI; reversing the travel direction mirrors the bend.
    let a = s.angle % (2 * Math.PI); if (a < 0) a += 2 * Math.PI;
    let bend = s.bend;
    if (a >= Math.PI) { a -= Math.PI; bend = -bend; }
    let qa = Math.round(a / Math.PI * 256);
    if (qa >= 256) { qa -= 256; bend = -bend; }
    dv.setUint8(o + 4, qa);
    const qw = widthToByte(s.width);
    const w = widthFromByte(qw);
    dv.setUint8(o + 5, Math.max(0, Math.min(255, Math.round(s.len / w * 16))));
    dv.setInt8(o + 6, Math.max(-127, Math.min(127, Math.round(bend / Math.PI * 127))));
    dv.setUint8(o + 7, qw);
    dv.setUint8(o + 8, s.r); dv.setUint8(o + 9, s.g); dv.setUint8(o + 10, s.b);
    dv.setUint8(o + 11, (Math.round(Math.max(0, Math.min(1, s.alpha)) * 15) << 4) | (s.seed & 15));
    o += RECORD_BYTES;
  }
  return new Uint8Array(buf);
}

export function decodeStroke(dv: DataView, i: number, ox = 0, oy = 0): Stroke {
  const o = i * RECORD_BYTES;
  const width = widthFromByte(dv.getUint8(o + 7));
  const as = dv.getUint8(o + 11);
  return {
    cx: dv.getUint16(o, true) / POS_SCALE - POS_OFFSET + ox,
    cy: dv.getUint16(o + 2, true) / POS_SCALE - POS_OFFSET + oy,
    angle: dv.getUint8(o + 4) / 256 * Math.PI,
    len: dv.getUint8(o + 5) / 16 * width,
    bend: dv.getInt8(o + 6) / 127 * Math.PI,
    width,
    r: dv.getUint8(o + 8), g: dv.getUint8(o + 9), b: dv.getUint8(o + 10),
    alpha: (as >> 4) / 15,
    seed: as & 15,
  };
}

// Round-trip through the quantizer so the analyzer simulates exactly what is stored.
export function quantize(s: Stroke): Stroke {
  const dv = new DataView(encodeStrokes([s], 0, 0).buffer);
  return decodeStroke(dv, 0, 0, 0);
}

// ---- integer hash + value noise (mirrored in GLSL with uint math) ----
export function hash32(x: number): number {
  x = (x ^ 61) ^ (x >>> 16);
  x = Math.imul(x, 9) >>> 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d) >>> 0;
  x = x ^ (x >>> 15);
  return x >>> 0;
}
function h01(i: number, seed: number): number { return hash32((i + Math.imul(seed, 7919) + 1013) >>> 0) / 4294967296; }
export function vnoise1(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return h01(i >>> 0, seed) * (1 - u) + h01((i + 1) >>> 0, seed) * u;
}

// Shape constants shared with GLSL.
export const SOFT_FRAC = 0.3; // edge softness as a fraction of radius
export const MIN_SOFT = 0.6; // px at render scale (antialiasing floor)
export const BRISTLE_DEPTH = 0.16;
export const DRY_DEPTH = 0.3;

// Paint coverage of stroke s at local point (lx, ly) given in the stroke frame
// (x along the tangent at the center, y along the normal), scaled by `scale`
// render px per level px. Returns 0..1 (before alpha).
export function coverageLocal(lx: number, ly: number, s: Stroke, scale: number): number {
  const r = s.width * 0.5;
  const half = s.len * 0.5;
  let sArc: number, d: number, v: number;
  const k = s.len > 1e-4 ? s.bend / s.len : 0;
  if (Math.abs(k) < 1e-4) {
    sArc = Math.max(-half, Math.min(half, lx));
    const dx = lx - sArc;
    d = Math.sqrt(dx * dx + ly * ly);
    v = ly;
  } else {
    const R = 1 / k; // signed
    const qx = lx, qy = ly - R;
    const sg = k > 0 ? 1 : -1;
    const phi = Math.atan2(sg * qx, -sg * qy);
    sArc = Math.max(-half, Math.min(half, phi / k));
    const px = Math.sin(k * sArc) / k;
    const py = (1 - Math.cos(k * sArc)) / k;
    const dx = lx - px, dy = ly - py;
    d = Math.sqrt(dx * dx + dy * dy);
    v = sg * (Math.abs(R) - Math.sqrt(qx * qx + qy * qy));
  }
  const soft = Math.max(SOFT_FRAC * r, MIN_SOFT / scale);
  const shape = Math.max(0, Math.min(1, (r - d) / soft + 0.5));
  if (shape <= 0) return 0;
  // bristles: streaks across the width, scale-invariant (level px)
  const nb = 3 + r * 1.2;
  const bx = (Math.max(-1, Math.min(1, v / r)) * 0.5 + 0.5) * nb;
  const streak = vnoise1(bx, s.seed);
  const u = (sArc + half) / (2 * half + r); // 0 at tail start, ~1 at the end
  const dry = DRY_DEPTH * Math.max(0, Math.min(1, (u - 0.55) / 0.45)) * vnoise1(bx * 1.7 + 5, s.seed + 1);
  return shape * (1 - BRISTLE_DEPTH * streak) * (1 - dry);
}

// Oriented bounding box half-extents in the stroke frame, padded for softness.
export function strokeExtent(s: Stroke, scale: number): StrokeExtent {
  const r = s.width * 0.5;
  const pad = r + Math.max(SOFT_FRAC * r, MIN_SOFT / scale) + 1 / scale;
  const half = s.len * 0.5;
  const k = s.len > 1e-4 ? s.bend / s.len : 0;
  let xmax: number, sag: number;
  if (Math.abs(k) < 1e-4) { xmax = half; sag = 0; }
  else {
    const t = Math.min(Math.abs(k * half), Math.PI / 2);
    xmax = Math.abs(k * half) > Math.PI / 2 ? Math.abs(1 / k) : Math.abs(Math.sin(k * half) / k);
    sag = (1 - Math.cos(Math.abs(k * half))) / k;
    void t;
  }
  return {
    x0: -xmax - pad, x1: xmax + pad,
    y0: Math.min(0, sag) - pad, y1: Math.max(0, sag) + pad,
  };
}
