// Remove craquelure (age cracks in the varnish) while keeping Bosch's own fine lines.
// Cracks are thin and low-contrast; painted contours are thin and high-contrast.
// Dark cracks: grey closing, accepted where the top-hat is inside a contrast band.
// Bright cracks (on dark paint): grey opening, same idea, only in dark regions.

function lum(b: Uint8Array, i: number): number { return 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]; }
function ramp(x: number, a: number, b: number): number { return x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); }

// Separable square min/max filter per channel, van Herk / Gil-Werman: O(1) per pixel for any radius.
function line1D(f: Uint8Array, n: number, rad: number, isMax: boolean, g: Uint8Array, h: Uint8Array, out: Uint8Array): void {
  const k = 2 * rad + 1;
  const m = n + 2 * rad; // padded length, edges replicated
  const at = (i: number) => f[Math.max(0, Math.min(n - 1, i - rad))];
  for (let i = 0; i < m; i++) {
    const v = at(i);
    g[i] = i % k === 0 ? v : (isMax ? Math.max(g[i - 1], v) : Math.min(g[i - 1], v));
  }
  for (let i = m - 1; i >= 0; i--) {
    const v = at(i);
    h[i] = (i + 1) % k === 0 || i === m - 1 ? v : (isMax ? Math.max(h[i + 1], v) : Math.min(h[i + 1], v));
  }
  for (let i = 0; i < n; i++) {
    const a = h[i], b = g[i + 2 * rad];
    out[i] = isMax ? (a > b ? a : b) : (a < b ? a : b);
  }
}

function morph(src: Uint8Array, W: number, H: number, rad: number, isMax: boolean): Uint8Array {
  const out = new Uint8Array(src.length);
  const L = Math.max(W, H);
  const f = new Uint8Array(L), o = new Uint8Array(L);
  const g = new Uint8Array(L + 2 * rad), h = new Uint8Array(L + 2 * rad);
  const tmp = new Uint8Array(src.length);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) f[x] = src[(y * W + x) * 3 + c];
      line1D(f, W, rad, isMax, g, h, o);
      for (let x = 0; x < W; x++) tmp[(y * W + x) * 3 + c] = o[x];
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = tmp[(y * W + x) * 3 + c];
      line1D(f, H, rad, isMax, g, h, o);
      for (let y = 0; y < H; y++) out[(y * W + x) * 3 + c] = o[y];
    }
  }
  return out;
}

// Light 3-tap binomial blur (twice) to hide the square structuring element.
function soften(src: Uint8Array, W: number, H: number, passes: number): Uint8Array {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const t = new Uint8Array(a.length), o = new Uint8Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1);
      for (let c = 0; c < 3; c++) t[(y * W + x) * 3 + c] = (a[(y * W + xm) * 3 + c] + 2 * a[(y * W + x) * 3 + c] + a[(y * W + xp) * 3 + c] + 2) >> 2;
    }
    for (let y = 0; y < H; y++) {
      const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
      for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) o[(y * W + x) * 3 + c] = (t[(ym * W + x) * 3 + c] + 2 * t[(y * W + x) * 3 + c] + t[(yp * W + x) * 3 + c] + 2) >> 2;
    }
    a = o;
  }
  return a;
}

export function decrack(src: Uint8Array, W: number, H: number, rad = 2, k = 1): Uint8Array {
  const passes = Math.max(1, Math.round(rad / 2));
  const closed = soften(morph(morph(src, W, H, rad, true), W, H, rad, false), W, H, passes);
  const opened = soften(morph(morph(src, W, H, rad, false), W, H, rad, true), W, H, passes);
  const out = new Uint8Array(src.length);
  for (let i = 0; i < W * H * 3; i += 3) {
    const lo = lum(src, i);
    const bt = lum(closed, i) - lo;
    const md = ramp(bt, 2 * k, 6 * k) * (1 - ramp(bt, 45, 80));
    let r = src[i] + (closed[i] - src[i]) * md;
    let g = src[i + 1] + (closed[i + 1] - src[i + 1]) * md;
    let b = src[i + 2] + (closed[i + 2] - src[i + 2]) * md;
    const lop = lum(opened, i);
    const wt = lo - lop;
    const mb = ramp(wt, 2 * k, 6 * k) * (1 - ramp(wt, 22, 40)) * (1 - ramp(lop, 70, 110));
    r += (opened[i] - r) * mb; g += (opened[i + 1] - g) * mb; b += (opened[i + 2] - b) * mb;
    out[i] = Math.round(r); out[i + 1] = Math.round(g); out[i + 2] = Math.round(b);
  }
  return out;
}
