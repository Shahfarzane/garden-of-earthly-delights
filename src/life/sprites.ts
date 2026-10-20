// Living-layer sprites for "The Garden of Earthly Delights".
//
// Every sprite draws centred at the origin, facing +x, in local units where the
// body length is 1. The caller sets the transform (translate / rotate / scale).
// Signature: draw(ctx, t, o)
//   t  animation time of this creature in seconds
//   o  options: { px, palette, phase, glide, flap, pose, ... } (all optional)
//      o.px = how many screen pixels the body length covers (drives LOD).
//
// Everything here is Canvas2D paths, gradients and procedural marks. No images.
// Style target: Bosch. Small, precise, slightly naive medieval rendering with a
// fine dark outline and soft modelling.

// Drawing options, all optional. Which ones a sprite reads is in its function.
export interface SpriteOptions {
  px?: number; // screen px per body length: the level of detail
  pxPerUnit?: number; // drawItem: screen px per unit, when px is not given
  palette?: string; phase?: number; pose?: string;
  glide?: number | null; flap?: number | null; // flying birds and butterflies
  dip?: number; reflection?: boolean; // water birds
  rest?: number; hop?: number; wag?: number; bend?: number; // insects, frog, fish
  heat?: number; trail?: boolean; age?: number; life?: number; // embers, smoke
  width?: number; color?: string; blend?: GlobalCompositeOperation; dust?: number; // light, flame
  speed?: number; // droplets
}
export type SpriteDraw = (ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions) => void;

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

/** Bosch's fine dark line. */
export const INK = 'rgba(36,22,10,0.92)';
const INK_SOFT = 'rgba(36,22,10,0.55)';

/**
 * Level of detail from screen pixels per body length.
 * 0: < 6 px   cheap silhouette, one or two fills
 * 1: < 18 px  silhouette + main colour patches
 * 2: < 40 px  outlines, eyes, beaks
 * 3: >= 40 px full detail: gradients, feathers, highlights
 */
export function lodOf(o: SpriteOptions): number {
  const px = o && o.px != null ? o.px : 60;
  return px < 6 ? 0 : px < 18 ? 1 : px < 40 ? 2 : 3;
}

function lineW(o: SpriteOptions, mul = 1): number {
  const px = (o && o.px) || 60;
  return clamp(1.05 / px, 0.004, 0.09) * mul;
}

function ink(ctx: CanvasRenderingContext2D, o: SpriteOptions, mul = 1, soft = false): void {
  ctx.lineWidth = lineW(o, mul);
  ctx.strokeStyle = soft ? INK_SOFT : INK;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

// Gradients are defined in local units, so one gradient object per (ctx, key)
// can be reused across every instance: the CTM maps it at fill time.
type Stops = [offset: number, color: string][];
const gradCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();
function gradFor(ctx: CanvasRenderingContext2D, key: string, make: (c: CanvasRenderingContext2D) => CanvasGradient): CanvasGradient {
  let m = gradCache.get(ctx);
  if (!m) { m = new Map(); gradCache.set(ctx, m); }
  let g = m.get(key);
  if (!g) { g = make(ctx); m.set(key, g); }
  return g;
}
function radial(ctx: CanvasRenderingContext2D, key: string, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, stops: Stops): CanvasGradient {
  return gradFor(ctx, key, (c) => {
    const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const [p, col] of stops) g.addColorStop(p, col);
    return g;
  });
}
function linear(ctx: CanvasRenderingContext2D, key: string, x0: number, y0: number, x1: number, y1: number, stops: Stops): CanvasGradient {
  return gradFor(ctx, key, (c) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    for (const [p, col] of stops) g.addColorStop(p, col);
    return g;
  });
}

/** Soft modelled fill: light at the upper front, base colour, shadow at the rim. */
function shade(ctx: CanvasRenderingContext2D, lod: number, key: string, cx: number, cy: number, r: number, light: string, base: string, dark: string): string | CanvasGradient {
  if (lod < 3) return base;
  return radial(ctx, key, cx - r * 0.25, cy - r * 0.35, r * 0.05, cx, cy, r * 1.15,
    [[0, light], [0.55, base], [1, dark]]);
}

function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rot, 0, TAU);
}

function eye(ctx: CanvasRenderingContext2D, lod: number, x: number, y: number, r: number, ring: string | null = null): void {
  if (lod < 2) return;
  if (ring) { ctx.fillStyle = ring; ellipse(ctx, x, y, r * 1.6, r * 1.6); ctx.fill(); }
  ctx.fillStyle = '#120c08';
  ellipse(ctx, x, y, r, r);
  ctx.fill();
  if (lod >= 3) {
    ctx.fillStyle = 'rgba(255,250,240,0.9)';
    ellipse(ctx, x - r * 0.35, y - r * 0.35, r * 0.32, r * 0.32);
    ctx.fill();
  }
}

/** Flap state for flying birds: up in [-1,1] (1 = wings raised), glide in [0,1]. */
function flapState(t: number, o: SpriteOptions, freq: number, glideDuty: number): { up: number; glide: number } {
  const ph = o.phase || 0;
  let glide = o.glide;
  if (glide == null) {
    const P = 2.6;
    const u = ((((t * 0.33 + ph * 0.21) % P) + P) % P) / P;
    const a = 1 - glideDuty;
    glide = smooth(a - 0.06, a + 0.06, u) * (1 - smooth(0.94, 1.0, u));
  }
  const w = o.flap != null ? o.flap : Math.cos(TAU * freq * t + ph);
  return { up: w * (1 - glide), glide };
}

// ---------------------------------------------------------------------------
// Generic flying bird (seen from below / above, wings in the ±y plane)
// ---------------------------------------------------------------------------

/**
 * P: { top, belly, head, beak, wingTip?, tailFork, span, shape: 'swept'|'pointed'|'broad',
 *      freq, glideDuty, fingers?, tailLen, bodyR }
 */
interface FlyPalette {
  key: string; top: string; belly: string; bellyBase?: string; head: string; throat?: string;
  beak: string; beakLen: number; span: number; shape: 'swept' | 'pointed' | 'broad'; freq: number; glideDuty: number;
  tailFork: number; tailLen: number; bodyR: number; fingers?: number; wingLight?: string; rim?: string; wingBar?: string;
  tail?: string; // the tail's colour, the top's when absent
}

function flyingBird(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions, P: FlyPalette): void {
  const lod = lodOf(o);
  const { up, glide } = flapState(t, o, P.freq, P.glideDuty);
  // projected span shrinks as wings leave the horizontal
  const k = Math.cos(up * (P.shape === 'broad' ? 0.7 : 1.05));
  const span = P.span * (0.98 + glide * 0.04);
  const bob = (1 - glide) * Math.sin(TAU * P.freq * t + (o.phase || 0)) * 0.025;
  const dark = P.top;
  const rim = P.rim; // optional warm rim light (hell birds on a dark sky)
  ctx.save();
  ctx.translate(0, bob);

  // Silhouette: body + wings + tail in one path (lod 0 only path)
  // chord shrinks toward the shoulder as the wings rise (seen edge-on)
  const cx = 0.55 + 0.45 * k;
  const X = (x: number) => 0.0 + (x - 0.0) * cx;
  const wing = (s: number) => {
    const ty = s * span * k;
    const sweep = P.shape === 'swept' ? -0.12 : P.shape === 'broad' ? 0.02 : -0.04;
    const tx = sweep - 0.08 * (1 - k); // tips drift back when folded
    ctx.moveTo(X(0.14), s * 0.06);
    if (P.shape === 'broad') {
      // straight-ish leading edge, squared hand with fingered primaries, curved trailing edge
      ctx.bezierCurveTo(X(0.22), s * span * 0.3, X(0.14), ty * 0.7, X(0.04), ty);
      const nf = lod >= 2 && P.fingers ? P.fingers : 1;
      for (let i = 1; i <= nf; i++) {
        const u0 = (i - 0.5) / nf, u1 = i / nf;
        if (nf > 1) ctx.lineTo(X(0.04 - 0.3 * u0), ty * (0.98 - 0.12 * u0) * 0.86);
        ctx.lineTo(X(0.04 - 0.3 * u1), ty * (0.98 - 0.12 * u1));
      }
      ctx.bezierCurveTo(X(-0.34), ty * 0.62, X(-0.36), s * span * 0.25, X(-0.2), s * 0.07);
    } else if (P.shape === 'swept') {
      ctx.bezierCurveTo(X(0.3), s * span * 0.3, X(0.1), ty * 0.85, X(tx), ty);
      ctx.bezierCurveTo(X(0.02), ty * 0.5, X(-0.05), s * span * 0.25, X(-0.16), s * 0.06);
    } else {
      ctx.bezierCurveTo(X(0.3), s * span * 0.35, X(0.12), ty * 0.9, X(tx), ty);
      ctx.bezierCurveTo(X(-0.12), ty * 0.7, X(-0.2), s * span * 0.3, X(-0.18), s * 0.07);
    }
    ctx.closePath();
  };
  const body = () => {
    ellipse(ctx, 0.02, 0, 0.3, P.bodyR, 0);
  };
  const tail = () => {
    const L = P.tailLen, f = P.tailFork;
    ctx.moveTo(-0.18, -0.07);
    ctx.lineTo(-0.18 - L, -0.07 - f * 0.9);
    ctx.lineTo(-0.18 - L * (f > 0.15 ? 0.5 : 1.0), 0);
    ctx.lineTo(-0.18 - L, 0.07 + f * 0.9);
    ctx.lineTo(-0.18, 0.07);
    ctx.closePath();
  };
  const head = () => {
    ellipse(ctx, 0.36, 0, 0.09, 0.075, 0);
  };

  if (rim && lod >= 2) {
    ctx.strokeStyle = rim; ctx.lineWidth = lineW(o, 2.2); ctx.lineJoin = 'round';
    ctx.beginPath(); wing(1); wing(-1); ctx.stroke();
    body(); ctx.stroke();
  }
  if (lod === 0) {
    ctx.fillStyle = dark;
    ctx.beginPath(); wing(1); wing(-1); tail(); ctx.fill();
    body(); ctx.fill();
    head(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0.42, -0.03); ctx.lineTo(0.52, 0); ctx.lineTo(0.42, 0.03); ctx.fill();
    ctx.restore();
    return;
  }

  // wings (undersides lighter when wings are down, i.e. up < 0)
  const wingCol = lod >= 3 && P.wingLight
    ? linear(ctx, 'fw-' + P.key, 0, -span, 0, span, [[0, P.wingLight], [0.5, P.top], [1, P.wingLight]])
    : P.top;
  ctx.fillStyle = wingCol;
  ctx.beginPath(); wing(1); wing(-1); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.9); ctx.stroke(); }
  if (lod >= 3 && P.wingBar) {
    ctx.fillStyle = P.wingBar;
    for (const s of [1, -1]) {
      const ty = s * span * k;
      ctx.beginPath();
      ctx.moveTo(0.06, s * 0.1); ctx.quadraticCurveTo(0.1, ty * 0.45, -0.02, ty * 0.8);
      ctx.lineTo(-0.06, ty * 0.75); ctx.quadraticCurveTo(0.02, ty * 0.45, -0.02, s * 0.1);
      ctx.closePath(); ctx.fill();
    }
  }

  // tail
  ctx.fillStyle = P.tail || P.top;
  ctx.beginPath(); tail(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }

  // body
  ctx.fillStyle = shade(ctx, lod, 'fb-' + P.key, 0.02, 0, 0.3, P.belly, P.bellyBase || P.belly, P.top);
  body(); ctx.fill();
  if (lod >= 2) { ink(ctx, o); ctx.stroke(); }
  if (lod >= 2 && P.throat) {
    ctx.fillStyle = P.throat;
    ellipse(ctx, 0.24, 0, 0.07, 0.06, 0); ctx.fill();
  }

  // head + beak
  ctx.fillStyle = P.head;
  head(); ctx.fill();
  if (lod >= 2) { ink(ctx, o); ctx.stroke(); }
  ctx.fillStyle = P.beak;
  ctx.beginPath(); ctx.moveTo(0.43, -0.03); ctx.lineTo(0.43 + P.beakLen, 0); ctx.lineTo(0.43, 0.03); ctx.closePath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.7); ctx.stroke(); }
  if (lod >= 2) {
    eye(ctx, lod, 0.37, -0.045, 0.018);
    eye(ctx, lod, 0.37, 0.045, 0.018);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Generic perched / standing bird (side view, feet at +y)
// ---------------------------------------------------------------------------

/**
 * P: { body, bodyLight, bodyDark, belly, wing, wingDark, head, crown?, cheek?, face?,
 *      beak, beakLen, beakThin?, legs, tail, tailLen, crest?, wingBars?, detail? }
 */
interface WingBar { x0: number; y0: number; x1: number; y1: number; w: number; color: string }
interface PerchPalette {
  key: string; body: string; bodyLight: string; bodyDark: string; belly: string; wing: string; wingDark: string;
  head: string; headLight?: string; headDark?: string; crown?: string; face?: string | null; cheek?: string;
  beak: string; beakLen: number; beakThin?: boolean; beakCurve?: boolean; legs: string; tail: string; tailLen: number;
  tailBar?: string; eyeRing?: string | null; eyeStripe?: string; tilt?: number; crest?: { color: string; tip: string; open?: number };
  wingBars?: WingBar[];
  detail?(ctx: CanvasRenderingContext2D, lod: number, hx: number, hy: number): void;
}

function perchedBird(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions, P: PerchPalette): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  const tilt = P.tilt != null ? P.tilt : -0.3;
  // small living movements: breathing, head turn, tail flick
  const breath = Math.sin(t * 2.1 + ph) * 0.006;
  const look = Math.sin(t * 0.7 + ph) * 0.5 + 0.5;   // 0..1 head slightly forward/back
  const flick = Math.max(0, Math.sin(t * 1.3 + ph * 1.7) - 0.85) * 0.5; // occasional tail flick
  const hx = 0.27 + look * 0.03, hy = -0.21 - look * 0.02;

  ctx.save();
  ctx.rotate(tilt * 0.15);

  const tailPath = () => {
    const L = P.tailLen, a = flick;
    ctx.moveTo(-0.16, -0.05);
    ctx.lineTo(-0.16 - L, 0.08 - a * 0.25);
    ctx.lineTo(-0.16 - L * 0.95, 0.16 - a * 0.25);
    ctx.lineTo(-0.12, 0.1);
    ctx.closePath();
  };
  const bodyPath = () => ellipse(ctx, 0.0, 0.0 + breath, 0.3, 0.19, tilt);
  const headPath = () => ellipse(ctx, hx, hy, 0.13, 0.115, 0);
  const beakPath = () => {
    const bx = hx + 0.1, by = hy + 0.01;
    ctx.moveTo(bx, by - 0.035 * (P.beakThin ? 0.6 : 1));
    if (P.beakCurve) {
      ctx.quadraticCurveTo(bx + P.beakLen * 0.6, by - 0.01, bx + P.beakLen, by + 0.05);
      ctx.quadraticCurveTo(bx + P.beakLen * 0.55, by + 0.03, bx, by + 0.03);
    } else {
      ctx.lineTo(bx + P.beakLen, by + 0.01);
      ctx.lineTo(bx, by + 0.035 * (P.beakThin ? 0.6 : 1));
    }
    ctx.closePath();
  };

  if (lod === 0) {
    ctx.fillStyle = P.body;
    ctx.beginPath(); tailPath(); ctx.fill();
    bodyPath(); ctx.fill();
    ctx.fillStyle = P.head; headPath(); ctx.fill();
    ctx.fillStyle = P.beak; ctx.beginPath(); beakPath(); ctx.fill();
    ctx.restore();
    return;
  }

  // legs
  if (lod >= 2) {
    ctx.strokeStyle = P.legs; ctx.lineWidth = lod >= 2 ? 0.022 : 0.03; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(0.04 + s * 0.03, 0.14);
      ctx.lineTo(0.07 + s * 0.04, 0.3);
      if (lod >= 2) { ctx.moveTo(0.0 + s * 0.04, 0.33); ctx.lineTo(0.14 + s * 0.04, 0.31); }
    }
    ctx.stroke();
  }

  // tail
  ctx.fillStyle = P.tail;
  ctx.beginPath(); tailPath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  if (lod >= 3 && P.tailBar) {
    ctx.fillStyle = P.tailBar;
    ctx.beginPath(); ctx.moveTo(-0.16 - P.tailLen * 0.55, 0.11); ctx.lineTo(-0.16 - P.tailLen * 0.75, 0.13);
    ctx.lineTo(-0.16 - P.tailLen * 0.72, 0.16); ctx.lineTo(-0.16 - P.tailLen * 0.5, 0.14); ctx.closePath(); ctx.fill();
  }

  // body with belly
  ctx.fillStyle = shade(ctx, lod, 'pb-' + P.key, 0, 0, 0.3, P.bodyLight || P.body, P.body, P.bodyDark || P.body);
  bodyPath(); ctx.fill();
  if (lod >= 1 && P.belly !== P.body) {
    if (lod >= 3) {
      ctx.save();
      bodyPath(); ctx.clip();
      ctx.fillStyle = radial(ctx, 'pbelly-' + P.key, 0.1, 0.1, 0.02, 0.05, 0.08, 0.3, [[0, P.belly], [0.7, P.belly], [1, 'rgba(0,0,0,0)']]);
      ellipse(ctx, 0.08, 0.1, 0.24, 0.14, tilt); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = P.belly;
      ellipse(ctx, 0.06, 0.07, 0.2, 0.09, tilt); ctx.fill();
    }
  }
  if (lod >= 2) { ink(ctx, o); bodyPath(); ctx.stroke(); }

  // folded wing
  const wingPath = () => {
    ctx.moveTo(0.1, -0.14);
    ctx.bezierCurveTo(0.08, -0.02, -0.1, 0.02, -0.3, 0.07);
    ctx.bezierCurveTo(-0.18, -0.02, -0.08, -0.14, 0.1, -0.14);
    ctx.closePath();
  };
  ctx.fillStyle = shade(ctx, lod, 'pw-' + P.key, -0.08, -0.05, 0.2, P.wing, P.wing, P.wingDark || P.wing);
  ctx.beginPath(); wingPath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.9); ctx.stroke(); }
  if (lod >= 2 && P.wingBars) {
    for (const bar of P.wingBars) {
      ctx.fillStyle = bar.color;
      ctx.beginPath();
      ctx.moveTo(bar.x0, bar.y0); ctx.lineTo(bar.x1, bar.y1); ctx.lineTo(bar.x1 - 0.02, bar.y1 + bar.w); ctx.lineTo(bar.x0 - 0.02, bar.y0 + bar.w);
      ctx.closePath(); ctx.fill();
    }
  }
  if (lod >= 3) {
    // feather edges: a few soft arcs along the wing
    ink(ctx, o, 0.7, true);
    for (let i = 0; i < 4; i++) {
      const u = 0.2 + i * 0.2;
      ctx.beginPath();
      ctx.moveTo(lerp(0.08, -0.26, u), lerp(-0.1, 0.05, u));
      ctx.quadraticCurveTo(lerp(0.0, -0.3, u), lerp(-0.04, 0.09, u), lerp(-0.02, -0.33, u), lerp(0.02, 0.1, u));
      ctx.stroke();
    }
  }

  // crest (hoopoe etc.)
  if (P.crest && lod >= 1) {
    const open = P.crest.open != null ? P.crest.open : 0.4 + 0.6 * smooth(0.6, 0.95, Math.sin(t * 0.9 + ph));
    if (lod < 2) {
      ctx.fillStyle = P.crest.color;
      ctx.beginPath(); ctx.moveTo(hx - 0.04, hy - 0.04); ctx.lineTo(hx - 0.2, hy - 0.2 * open - 0.04); ctx.lineTo(hx + 0.02, hy - 0.3); ctx.lineTo(hx + 0.1, hy - 0.08); ctx.closePath(); ctx.fill();
    }
    const n = lod >= 2 ? 7 : 0;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const a = -Math.PI * 0.95 + u * Math.PI * 0.75 * open - 0.1;
      const L = 0.2 + 0.1 * Math.sin(u * Math.PI);
      const x0 = hx - 0.02 + u * 0.06, y0 = hy - 0.06;
      const x1 = x0 + Math.cos(a) * L, y1 = y0 + Math.sin(a) * L;
      ctx.strokeStyle = P.crest.color; ctx.lineWidth = 0.045; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      if (lod >= 2) {
        ctx.strokeStyle = P.crest.tip; ctx.lineWidth = 0.045;
        ctx.beginPath(); ctx.moveTo(lerp(x0, x1, 0.75), lerp(y0, y1, 0.75)); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
  }

  // head
  ctx.fillStyle = shade(ctx, lod, 'ph-' + P.key, hx, hy, 0.13, P.headLight || P.head, P.head, P.headDark || P.head);
  headPath(); ctx.fill();
  if (lod >= 1 && (P.crown || P.face || P.cheek)) {
    if (lod >= 3) { ctx.save(); headPath(); ctx.clip(); }
    if (P.crown) { ctx.fillStyle = P.crown; if (lod >= 3) ellipse(ctx, hx - 0.02, hy - 0.1, 0.14, 0.08, 0); else ellipse(ctx, hx - 0.02, hy - 0.065, 0.1, 0.045, 0); ctx.fill(); }
    if (P.face) { ctx.fillStyle = P.face; if (lod >= 3) ellipse(ctx, hx + 0.09, hy + 0.01, 0.08, 0.1, 0); else ellipse(ctx, hx + 0.07, hy + 0.01, 0.055, 0.075, 0); ctx.fill(); }
    if (P.cheek && lod >= 2) { ctx.fillStyle = P.cheek; ellipse(ctx, hx + 0.01, hy + 0.04, 0.06, 0.05, 0); ctx.fill(); }
    if (lod >= 3) ctx.restore();
  }
  if (lod >= 2 && P.eyeStripe) {
    ctx.strokeStyle = P.eyeStripe; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.moveTo(hx - 0.1, hy - 0.02); ctx.lineTo(hx + 0.1, hy - 0.02); ctx.stroke();
  }
  if (lod >= 2) { ink(ctx, o); headPath(); ctx.stroke(); }

  // beak
  ctx.fillStyle = P.beak;
  ctx.beginPath(); beakPath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.7); ctx.stroke(); }
  if (lod >= 2) { ink(ctx, o, 0.6); ctx.beginPath(); ctx.moveTo(hx + 0.1, hy + 0.012); ctx.lineTo(hx + 0.1 + P.beakLen * 0.8, hy + 0.015); ctx.stroke(); }

  eye(ctx, lod, hx + 0.04, hy - 0.03, 0.024, P.eyeRing);
  if (P.detail) P.detail(ctx, lod, hx, hy);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

const FLY = {
  blackbird: { key: 'blackbird', top: '#1a1512', belly: '#2a221b', head: '#1a1512', beak: '#4a3a22', beakLen: 0.06, span: 0.5, shape: 'swept', freq: 7, glideDuty: 0.35, tailFork: 0.08, tailLen: 0.24, bodyR: 0.085 },
  swallow: { key: 'swallow', top: '#1d2238', belly: '#efe6d2', bellyBase: '#e2d6bd', head: '#1d2238', throat: '#b8512b', beak: '#2a2420', beakLen: 0.04, span: 0.62, shape: 'swept', freq: 6, glideDuty: 0.45, tailFork: 0.22, tailLen: 0.3, bodyR: 0.085, wingLight: '#3a4260' },
  raven: { key: 'raven', top: '#1c1715', belly: '#2d2420', head: '#1c1715', beak: '#4a4038', beakLen: 0.14, span: 0.72, shape: 'broad', freq: 2.4, glideDuty: 0.55, tailFork: 0.0, tailLen: 0.3, bodyR: 0.085, fingers: 5, wingLight: '#221e22', rim: 'rgba(170,120,70,0.45)' },
  goldfinchFly: { key: 'goldfinchFly', top: '#201a16', belly: '#e9dcc3', bellyBase: '#c9a97f', head: '#b9321e', beak: '#e3d6bb', beakLen: 0.06, span: 0.48, shape: 'pointed', freq: 9, glideDuty: 0.3, tailFork: 0.06, tailLen: 0.22, bodyR: 0.1, wingBar: '#e9c43a' },
  songbirdFly: { key: 'songbirdFly', top: '#5b4a33', belly: '#d9cdb2', head: '#5b4a33', beak: '#4a3a22', beakLen: 0.05, span: 0.48, shape: 'pointed', freq: 9, glideDuty: 0.3, tailFork: 0.03, tailLen: 0.22, bodyR: 0.1 },
  kingfisherFly: { key: 'kingfisherFly', top: '#1f7e95', belly: '#c6702d', head: '#1d6f85', beak: '#1c1a18', beakLen: 0.28, span: 0.5, shape: 'pointed', freq: 10, glideDuty: 0.2, tailFork: 0.0, tailLen: 0.12, bodyR: 0.1, wingLight: '#3fa7c0' },
  hoopoeFly: { key: 'hoopoeFly', top: '#1e1a16', belly: '#d6ad83', head: '#cfa070', beak: '#2a2420', beakLen: 0.25, span: 0.6, shape: 'broad', freq: 5, glideDuty: 0.2, tailFork: 0.0, tailLen: 0.22, bodyR: 0.1, wingBar: '#f0e6d4', fingers: 4 },
} satisfies Record<string, FlyPalette>;

const SONGBIRD_PALETTES: Record<string, PerchPalette> = {
  green: { key: 'sb-green', body: '#7c8a3a', bodyLight: '#aab85a', bodyDark: '#4e5a24', belly: '#cdd09a', wing: '#6c7a34', wingDark: '#3f4a1e', head: '#7f8c3e', crown: '#b83224', face: null, beak: '#5a4a32', beakLen: 0.16, legs: '#6a6a5a', tail: '#4e5a24', tailLen: 0.3, eyeRing: '#f0ecd8' },
  blue: { key: 'sb-blue', body: '#4f6f9e', bodyLight: '#8aa8cf', bodyDark: '#2f4a72', belly: '#e9d98a', wing: '#3f5e8e', wingDark: '#24395a', head: '#f1ecd9', crown: '#4f6f9e', beak: '#2a2420', beakLen: 0.06, legs: '#555b68', tail: '#3f5e8e', tailLen: 0.26, eyeStripe: '#1d2238', wingBars: [{ x0: 0.02, y0: -0.07, x1: -0.14, y1: -0.01, w: 0.03, color: '#f1ecd9' }] },
  brown: { key: 'sb-brown', body: '#8e6c47', bodyLight: '#b8956a', bodyDark: '#5a4027', belly: '#d8cdb6', wing: '#6a4a2c', wingDark: '#3d2a18', head: '#7f6248', cheek: '#dcd2bd', crown: '#5b4028', beak: '#4a3a22', beakLen: 0.07, legs: '#8a7b63', tail: '#4e361f', tailLen: 0.3, wingBars: [{ x0: 0.0, y0: -0.06, x1: -0.16, y1: 0.0, w: 0.025, color: '#e4dac5' }] },
  grey: { key: 'sb-grey', body: '#8c8f8a', bodyLight: '#bfc2bc', bodyDark: '#5a5d59', belly: '#e0b98a', wing: '#6a7390', wingDark: '#3e4659', head: '#8c8f8a', beak: '#2a2420', beakLen: 0.12, legs: '#6a6a5a', tail: '#3e4659', tailLen: 0.2, eyeStripe: '#1a1816' },
  red: { key: 'sb-red', body: '#a8422c', bodyLight: '#d97a55', bodyDark: '#6a2416', belly: '#c96a46', wing: '#3f2a28', wingDark: '#241614', head: '#a8422c', beak: '#e7c266', beakLen: 0.07, legs: '#7a5a4a', tail: '#3f2a28', tailLen: 0.3, crown: '#3f2a28' },
  white: { key: 'sb-white', body: '#efe9da', bodyLight: '#fbf8f0', bodyDark: '#b9b0a0', belly: '#efe9da', wing: '#d9d2c2', wingDark: '#9c9484', head: '#efe9da', beak: '#c09a5a', beakLen: 0.08, legs: '#c0a08a', tail: '#d9d2c2', tailLen: 0.3 },
};

// ---------------------------------------------------------------------------
// Water birds
// ---------------------------------------------------------------------------

function swan(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  const bob = Math.sin(t * 1.4 + ph) * 0.012;
  const dip = o.dip != null ? o.dip : smooth(0.86, 0.98, Math.sin(t * 0.35 + ph)); // occasional head dip
  const sway = Math.sin(t * 0.7 + ph) * 0.03;
  // neck control points
  const nx0 = 0.2, ny0 = -0.08;
  const hx = 0.42 + sway - dip * 0.1, hy = -0.5 + dip * 0.42;
  const c1x = 0.2, c1y = -0.4 + dip * 0.1;
  const c2x = 0.5 + sway, c2y = -0.62 + dip * 0.55;
  const white = lod >= 3 ? radial(ctx, 'swan-body', -0.15, -0.14, 0.02, -0.05, 0.0, 0.5, [[0, '#ffffff'], [0.55, '#f3f0e6'], [1, '#b6b2a4']]) : '#f3f0e6';

  ctx.save();
  ctx.translate(0, bob);
  ctx.rotate(Math.sin(t * 1.4 + ph + 1) * 0.015);

  // reflection (soft) at higher LOD
  if (lod >= 2 && o.reflection !== false) {
    ctx.save();
    ctx.globalAlpha *= 0.22;
    ctx.translate(0, 0.14);
    ctx.scale(1, -0.45);
    ctx.fillStyle = '#f3f0e6';
    ellipse(ctx, -0.05, 0.0, 0.42, 0.16, 0); ctx.fill();
    ctx.lineWidth = 0.09; ctx.strokeStyle = '#f3f0e6'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(nx0, ny0); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, hx, hy); ctx.stroke();
    ctx.restore();
  }

  // body
  ctx.fillStyle = white;
  ctx.beginPath();
  ctx.moveTo(-0.5, -0.1);              // raised tail tip
  ctx.quadraticCurveTo(-0.52, 0.08, -0.3, 0.14);
  ctx.lineTo(0.2, 0.14);
  ctx.quadraticCurveTo(0.42, 0.14, 0.4, -0.04);
  ctx.quadraticCurveTo(0.25, -0.2, 0.0, -0.18);
  // raised wing arch
  ctx.quadraticCurveTo(-0.1, -0.34, -0.3, -0.26);
  ctx.quadraticCurveTo(-0.42, -0.2, -0.5, -0.1);
  ctx.closePath();
  ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.9); ctx.stroke(); }
  if (lod >= 3) {
    // wing feather arcs
    ink(ctx, o, 0.7, true);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.08 - i * 0.06, -0.2 + i * 0.015);
      ctx.quadraticCurveTo(-0.2 - i * 0.06, -0.26 + i * 0.03, -0.36 - i * 0.03, -0.1 + i * 0.05);
      ctx.stroke();
    }
  }

  // neck
  ctx.strokeStyle = white; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = 0.1;
  ctx.beginPath(); ctx.moveTo(nx0, ny0); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, hx, hy); ctx.stroke();
  if (lod >= 2) {
    ink(ctx, o, 0.8);
    ctx.beginPath(); ctx.moveTo(nx0 - 0.04, ny0 - 0.03); ctx.bezierCurveTo(c1x - 0.05, c1y, c2x - 0.05, c2y, hx - 0.045, hy - 0.02); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nx0 + 0.05, ny0 + 0.0); ctx.bezierCurveTo(c1x + 0.05, c1y, c2x + 0.05, c2y, hx + 0.045, hy + 0.02); ctx.stroke();
  }
  // head
  ctx.fillStyle = white;
  ellipse(ctx, hx + 0.01, hy, 0.085, 0.06, -0.15); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  // beak with black knob/mask
  ctx.fillStyle = '#d6752c';
  ctx.beginPath(); ctx.moveTo(hx + 0.06, hy - 0.03); ctx.lineTo(hx + 0.22, hy + 0.01); ctx.lineTo(hx + 0.06, hy + 0.035); ctx.closePath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.7); ctx.stroke(); }
  if (lod >= 1) {
    ctx.fillStyle = '#1b1510';
    ctx.beginPath(); ctx.moveTo(hx + 0.05, hy - 0.035); ctx.lineTo(hx + 0.1, hy - 0.025); ctx.lineTo(hx + 0.09, hy + 0.0); ctx.lineTo(hx + 0.055, hy + 0.005); ctx.closePath(); ctx.fill();
  }
  eye(ctx, lod, hx + 0.04, hy - 0.012, 0.014);
  ctx.restore();

  // waterline ripples
  if (lod >= 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = lineW(o, 1.2);
    ctx.beginPath();
    const r = Math.sin(t * 1.1 + ph) * 0.02;
    ctx.moveTo(-0.62 + r, 0.17); ctx.quadraticCurveTo(-0.3, 0.21, 0.1, 0.17);
    ctx.moveTo(0.3 - r, 0.19); ctx.quadraticCurveTo(0.5, 0.21, 0.66, 0.18);
    ctx.stroke();
  }
}

const DUCK_PALETTES = {
  mallard: { key: 'mallard', body: '#b9b2a0', bodyLight: '#ddd7c6', bodyDark: '#7a7462', chest: '#6b3f26', head: '#2f6b36', headLight: '#5aa05a', headDark: '#173820', ring: '#f1ecd9', bill: '#d9b24a', tail: '#2a2622', speculum: '#3b5ea8', legs: '#d2742e' },
  female: { key: 'duck-f', body: '#9a7e58', bodyLight: '#c8ad84', bodyDark: '#5e4a2e', chest: '#8a6c48', head: '#8a6c48', headLight: '#b19470', headDark: '#5e4a2e', ring: null, bill: '#8a6a3a', tail: '#5e4a2e', speculum: '#3b5ea8', legs: '#c26a2e' },
  dark: { key: 'duck-d', body: '#221d19', bodyLight: '#3f3630', bodyDark: '#100d0b', chest: '#221d19', head: '#221d19', headLight: '#3f3630', headDark: '#100d0b', ring: null, bill: '#c9c0a8', tail: '#100d0b', speculum: null, legs: '#5a4a3a' },
};

function duck(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const P = DUCK_PALETTES[o.palette as keyof typeof DUCK_PALETTES] || DUCK_PALETTES.mallard;
  const ph = o.phase || 0;
  const bob = Math.sin(t * 1.8 + ph) * 0.012;
  const dab = o.dip != null ? o.dip : smooth(0.9, 1, Math.sin(t * 0.5 + ph * 1.3)); // dabbling head dip
  const hx = 0.3 + dab * 0.06, hy = -0.22 + dab * 0.2;
  ctx.save();
  ctx.translate(0, bob);
  ctx.rotate(Math.sin(t * 1.8 + ph + 1) * 0.015 + dab * 0.2);

  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(-0.42, -0.1);
    ctx.quadraticCurveTo(-0.5, 0.06, -0.3, 0.14);
    ctx.lineTo(0.22, 0.14);
    ctx.quadraticCurveTo(0.42, 0.12, 0.38, -0.06);
    ctx.quadraticCurveTo(0.2, -0.2, -0.05, -0.17);
    ctx.quadraticCurveTo(-0.3, -0.16, -0.42, -0.1);
    ctx.closePath();
  };
  ctx.fillStyle = shade(ctx, lod, 'db-' + P.key, -0.02, 0, 0.42, P.bodyLight, P.body, P.bodyDark);
  bodyPath(); ctx.fill();
  if (lod >= 1 && P.chest !== P.body) {
    ctx.fillStyle = P.chest;
    if (lod >= 3) { ctx.save(); bodyPath(); ctx.clip(); ellipse(ctx, 0.32, -0.02, 0.14, 0.16, 0.2); ctx.fill(); ctx.restore(); }
    else { ellipse(ctx, 0.28, 0.0, 0.1, 0.12, 0.2); ctx.fill(); }
  }
  if (lod >= 2 && P.speculum) {
    ctx.fillStyle = P.speculum;
    ctx.beginPath(); ctx.moveTo(-0.12, -0.08); ctx.lineTo(-0.3, -0.03); ctx.lineTo(-0.28, 0.0); ctx.lineTo(-0.1, -0.05); ctx.closePath(); ctx.fill();
  }
  if (lod >= 2) {
    // folded wing line
    ink(ctx, o, 0.8, true);
    ctx.beginPath(); ctx.moveTo(0.12, -0.14); ctx.quadraticCurveTo(-0.1, -0.1, -0.34, -0.02); ctx.stroke();
  }
  if (lod >= 2) { ink(ctx, o); bodyPath(); ctx.stroke(); }
  // curled tail feather (drake)
  if (lod >= 2 && P.key === 'mallard') {
    ctx.strokeStyle = P.tail; ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.moveTo(-0.36, -0.12); ctx.quadraticCurveTo(-0.44, -0.22, -0.36, -0.22); ctx.stroke();
  }
  // neck + head
  ctx.strokeStyle = P.head; ctx.lineWidth = 0.12; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0.26, -0.08); ctx.lineTo(hx - 0.02, hy + 0.02); ctx.stroke();
  if (lod >= 2 && P.ring) {
    ctx.strokeStyle = P.ring; ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.moveTo(0.2, -0.1); ctx.lineTo(0.3, -0.08); ctx.stroke();
  }
  ctx.fillStyle = shade(ctx, lod, 'dh-' + P.key, hx, hy, 0.12, P.headLight, P.head, P.headDark);
  ellipse(ctx, hx, hy, 0.12, 0.1, 0); ctx.fill();
  if (lod >= 2) { ink(ctx, o); ctx.stroke(); }
  // bill
  ctx.fillStyle = P.bill;
  ctx.beginPath(); ctx.moveTo(hx + 0.09, hy - 0.035); ctx.lineTo(hx + 0.27, hy + 0.0); ctx.quadraticCurveTo(hx + 0.2, hy + 0.045, hx + 0.09, hy + 0.035); ctx.closePath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.7); ctx.stroke(); ink(ctx, o, 0.6); ctx.beginPath(); ctx.moveTo(hx + 0.1, hy + 0.01); ctx.lineTo(hx + 0.25, hy + 0.01); ctx.stroke(); }
  eye(ctx, lod, hx + 0.04, hy - 0.025, 0.018);
  ctx.restore();
  if (lod >= 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = lineW(o, 1.2);
    ctx.beginPath(); ctx.moveTo(-0.56, 0.17); ctx.quadraticCurveTo(-0.2, 0.2, 0.1, 0.17); ctx.moveTo(0.3, 0.18); ctx.quadraticCurveTo(0.45, 0.2, 0.6, 0.18); ctx.stroke();
  }
}

const HERON_PALETTES = {
  white: { key: 'heron-w', body: '#f2eee2', light: '#ffffff', dark: '#b3ad9c', beak: '#d9b24a', legs: '#2a2622', plume: '#f8f5ec' },
  grey: { key: 'heron-g', body: '#9ea4a8', light: '#d0d4d6', dark: '#5f6569', beak: '#d9b24a', legs: '#4a4a44', plume: '#2a2622' },
};

function heron(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const P = HERON_PALETTES[o.palette as keyof typeof HERON_PALETTES] || HERON_PALETTES.white;
  const ph = o.phase || 0;
  // occasional head dip to the water, otherwise a slow alert turn
  const dip = o.dip != null ? o.dip : smooth(0.82, 0.97, Math.sin(t * 0.3 + ph)) * (1 - smooth(0.97, 1.0, Math.sin(t * 0.3 + ph)));
  const look = Math.sin(t * 0.5 + ph) * 0.02;
  const hx = lerp(0.22, 0.46, dip) + look, hy = lerp(-0.56, -0.08, dip);
  const c1x = 0.12, c1y = lerp(-0.45, -0.3, dip);
  const c2x = lerp(0.3, 0.55, dip), c2y = lerp(-0.6, -0.25, dip);
  const fill = shade(ctx, lod, 'hb-' + P.key, -0.05, -0.1, 0.3, P.light, P.body, P.dark);
  ctx.save();
  // legs
  if (lod >= 1) {
    ctx.strokeStyle = P.legs; ctx.lineWidth = lod >= 2 ? 0.02 : 0.03; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.04, 0.02); ctx.lineTo(-0.06, 0.22); ctx.lineTo(-0.02, 0.46);
    ctx.moveTo(0.04, 0.02); ctx.lineTo(0.06, 0.22); ctx.lineTo(0.08, 0.46);
    if (lod >= 2) { ctx.moveTo(-0.1, 0.47); ctx.lineTo(0.06, 0.46); ctx.moveTo(0.0, 0.47); ctx.lineTo(0.16, 0.46); }
    ctx.stroke();
  }
  // body
  const bodyPath = () => ellipse(ctx, -0.06, -0.1, 0.27, 0.12, -0.25);
  ctx.fillStyle = fill; bodyPath(); ctx.fill();
  // tail plumes
  ctx.fillStyle = P.plume;
  ctx.beginPath(); ctx.moveTo(-0.26, -0.18); ctx.lineTo(-0.45, -0.06); ctx.lineTo(-0.4, -0.0); ctx.lineTo(-0.24, -0.08); ctx.closePath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); ink(ctx, o); bodyPath(); ctx.stroke(); }
  if (lod >= 3) {
    ink(ctx, o, 0.7, true);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(0.02 - i * 0.07, -0.2 + i * 0.03); ctx.quadraticCurveTo(-0.12 - i * 0.07, -0.16 + i * 0.03, -0.26 - i * 0.05, -0.02 + i * 0.02); ctx.stroke();
    }
  }
  // neck
  ctx.strokeStyle = P.body; ctx.lineWidth = 0.075; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0.14, -0.18); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, hx, hy); ctx.stroke();
  if (lod >= 2) {
    ink(ctx, o, 0.8);
    ctx.beginPath(); ctx.moveTo(0.1, -0.2); ctx.bezierCurveTo(c1x - 0.04, c1y, c2x - 0.04, c2y, hx - 0.035, hy - 0.01); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.18, -0.16); ctx.bezierCurveTo(c1x + 0.04, c1y, c2x + 0.04, c2y, hx + 0.035, hy + 0.01); ctx.stroke();
  }
  // head
  ctx.fillStyle = fill;
  ellipse(ctx, hx + 0.01, hy, 0.075, 0.055, 0.1); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  // crest wisps
  if (lod >= 2) {
    ctx.strokeStyle = P.plume; ctx.lineWidth = 0.02;
    ctx.beginPath(); ctx.moveTo(hx - 0.05, hy - 0.02); ctx.lineTo(hx - 0.16, hy + 0.01); ctx.moveTo(hx - 0.05, hy); ctx.lineTo(hx - 0.15, hy + 0.05); ctx.stroke();
  }
  // beak: dagger
  ctx.fillStyle = P.beak;
  ctx.beginPath(); ctx.moveTo(hx + 0.06, hy - 0.025); ctx.lineTo(hx + 0.3, hy + 0.02 + dip * 0.04); ctx.lineTo(hx + 0.06, hy + 0.025); ctx.closePath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.7); ctx.stroke(); }
  eye(ctx, lod, hx + 0.03, hy - 0.012, 0.014, lod >= 3 ? '#e8d27a' : null);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Insects, frog, fish
// ---------------------------------------------------------------------------

interface ButterflyPalette { key: string; wing: string; light: string; edge: string; spots: string; hind: string; blueDots?: string }
const BUTTERFLY_PALETTES: Record<string, ButterflyPalette> = {
  white: { key: 'bf-white', wing: '#efe9d8', light: '#fbf8ee', edge: '#2a2420', spots: '#2a2420', hind: '#e5dcc4' },
  orange: { key: 'bf-orange', wing: '#d2772a', light: '#eea24c', edge: '#2a1c12', spots: '#2a1c12', hind: '#b8601f', blueDots: '#6f8fc4' },
  blue: { key: 'bf-blue', wing: '#6d84c2', light: '#9ab2e0', edge: '#2a2a38', spots: '#f1ecd9', hind: '#5c72ad' },
  yellow: { key: 'bf-yellow', wing: '#d9c74a', light: '#f0e27a', edge: '#4a3a1a', spots: '#b8562a', hind: '#cdb93f' },
};

function butterfly(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const P = BUTTERFLY_PALETTES[o.palette as keyof typeof BUTTERFLY_PALETTES] || BUTTERFLY_PALETTES.white;
  const ph = o.phase || 0;
  const freq = o.rest ? 0.4 : 9;
  const w = o.flap != null ? o.flap : Math.cos(TAU * freq * t + ph);
  const k = o.rest ? 0.15 + 0.1 * (0.5 + 0.5 * w) : 0.22 + 0.78 * Math.abs(w);
  ctx.save();
  ctx.scale(1, k);
  const fore = (s: number) => {
    ctx.moveTo(0.05, s * 0.04);
    ctx.bezierCurveTo(0.2, s * 0.15, 0.4, s * 0.4, 0.26, s * 0.52);
    ctx.bezierCurveTo(0.12, s * 0.56, -0.05, s * 0.35, -0.06, s * 0.08);
    ctx.closePath();
  };
  const hind = (s: number) => {
    ctx.moveTo(-0.05, s * 0.05);
    ctx.bezierCurveTo(-0.12, s * 0.3, -0.3, s * 0.45, -0.38, s * 0.3);
    ctx.bezierCurveTo(-0.42, s * 0.15, -0.3, s * 0.06, -0.14, s * 0.03);
    ctx.closePath();
  };
  if (lod === 0) {
    ctx.fillStyle = P.wing;
    ctx.beginPath(); fore(1); fore(-1); hind(1); hind(-1); ctx.fill();
    ctx.restore();
    return;
  }
  const wingFill = lod >= 3
    ? radial(ctx, 'bfw-' + P.key, 0.0, 0, 0.05, 0.0, 0, 0.55, [[0, P.light], [0.6, P.wing], [1, P.hind]])
    : P.wing;
  ctx.fillStyle = P.hind;
  ctx.beginPath(); hind(1); hind(-1); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  ctx.fillStyle = wingFill;
  ctx.beginPath(); fore(1); fore(-1); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  // markings
  if (lod >= 1) {
    ctx.fillStyle = P.edge;
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(0.3, s * 0.36); ctx.bezierCurveTo(0.36, s * 0.44, 0.3, s * 0.52, 0.26, s * 0.52);
      ctx.bezierCurveTo(0.2, s * 0.54, 0.16, s * 0.5, 0.17, s * 0.46); ctx.closePath(); ctx.fill();
    }
  }
  if (lod >= 2) {
    ctx.fillStyle = P.spots;
    for (const s of [1, -1]) {
      ellipse(ctx, 0.12, s * 0.3, 0.035, 0.03); ctx.fill();
      if (P.blueDots) { ctx.fillStyle = P.blueDots; for (let i = 0; i < 3; i++) { ellipse(ctx, -0.3 + i * 0.07, s * (0.36 - i * 0.03), 0.02, 0.02); ctx.fill(); } ctx.fillStyle = P.spots; }
    }
  }
  if (lod >= 3) {
    // veins
    ink(ctx, o, 0.6, true);
    for (const s of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        const u = i / 3;
        ctx.beginPath(); ctx.moveTo(0.0, s * 0.06);
        ctx.quadraticCurveTo(lerp(0.0, 0.25, u) + 0.05, s * lerp(0.2, 0.42, u), lerp(-0.02, 0.3, u), s * lerp(0.42, 0.5, u) * 1.05);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  // body + antennae (not squashed with wings)
  ctx.fillStyle = '#2a2018';
  ellipse(ctx, -0.04, 0, 0.19, 0.035); ctx.fill();
  if (lod >= 2) {
    ellipse(ctx, 0.15, 0, 0.035, 0.035); ctx.fill();
    ink(ctx, o, 0.7);
    ctx.beginPath(); ctx.moveTo(0.17, -0.01); ctx.quadraticCurveTo(0.26, -0.1, 0.32, -0.12); ctx.moveTo(0.17, 0.01); ctx.quadraticCurveTo(0.26, 0.1, 0.32, 0.12); ctx.stroke();
  }
}

const DRAGONFLY_PALETTES = {
  blue: { key: 'df-blue', body: '#4a86c4', light: '#8dbbe6', dark: '#1e3f66', bands: '#1b1a24', eye: '#2d5f8e' },
  green: { key: 'df-green', body: '#5f9b4a', light: '#9ad07e', dark: '#2a4f20', bands: '#1e2418', eye: '#4a8a3a' },
  red: { key: 'df-red', body: '#c24d2c', light: '#ea8a62', dark: '#6a2412', bands: '#2a1410', eye: '#8a2a1a' },
};

function dragonfly(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const P = DRAGONFLY_PALETTES[o.palette as keyof typeof DRAGONFLY_PALETTES] || DRAGONFLY_PALETTES.blue;
  const ph = o.phase || 0;
  const rest = !!o.rest;
  const wingPair = (ang: number, alpha: number) => {
    ctx.save();
    ctx.globalAlpha *= alpha;
    for (const s of [1, -1]) {
      for (const [x0, a0, L] of [[0.21, 1.15, 0.46], [0.13, 1.42, 0.43]]) {
        const a = s * (a0 + ang);
        ctx.fillStyle = lod >= 3 ? 'rgba(225,232,240,0.5)' : 'rgba(225,232,240,0.6)';
        if (lod < 3) {
          ellipse(ctx, x0 + Math.cos(a) * L / 2, Math.sin(a) * L / 2, L / 2, 0.042, a); ctx.fill();
          if (lod >= 2) { ctx.strokeStyle = 'rgba(40,30,30,0.5)'; ctx.lineWidth = lineW(o, 0.7); ctx.stroke(); }
          continue;
        }
        ctx.save();
        ctx.translate(x0, 0);
        ctx.rotate(a);
        ellipse(ctx, L / 2, 0, L / 2, 0.042); ctx.fill();
        ctx.strokeStyle = 'rgba(40,30,30,0.5)'; ctx.lineWidth = lineW(o, 0.7); ctx.stroke();
        {
          ctx.strokeStyle = 'rgba(40,30,30,0.35)'; ctx.lineWidth = lineW(o, 0.5);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0);
          for (let i = 1; i < 6; i++) { ctx.moveTo(L * i / 6, -0.05); ctx.lineTo(L * i / 6 + 0.02, 0.05); }
          ctx.stroke();
          ctx.fillStyle = '#2a2020'; ellipse(ctx, L * 0.88, -0.02, 0.03, 0.015); ctx.fill(); // pterostigma
        }
        ctx.restore();
      }
    }
    ctx.restore();
  };
  if (lod === 0) {
    ctx.fillStyle = P.body;
    ctx.beginPath(); ctx.rect(-0.5, -0.03, 0.9, 0.06); ctx.fill();
    ctx.fillStyle = 'rgba(225,232,240,0.6)';
    ctx.beginPath(); ctx.rect(-0.15, -0.4, 0.35, 0.8); ctx.fill();
    return;
  }
  if (rest) wingPair(-0.35, 1);
  else if (lod < 2) wingPair(0, 0.8);
  else { const a = Math.sin(TAU * 20 * t + ph) * 0.1; wingPair(a, 0.6); wingPair(-a, 0.6); }
  // abdomen
  ctx.fillStyle = lod >= 3 ? linear(ctx, 'dfb-' + P.key, 0, -0.04, 0, 0.04, [[0, P.light], [0.5, P.body], [1, P.dark]]) : P.body;
  ctx.beginPath(); ctx.moveTo(0.1, -0.035); ctx.lineTo(-0.5, -0.02); ctx.lineTo(-0.5, 0.02); ctx.lineTo(0.1, 0.035); ctx.closePath(); ctx.fill();
  if (lod >= 2) {
    ink(ctx, o, 0.8); ctx.stroke();
    ctx.fillStyle = P.bands;
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.rect(-0.44 + i * 0.075, -0.03, 0.02, 0.06); ctx.fill(); }
  }
  // thorax
  ctx.fillStyle = P.body; ellipse(ctx, 0.17, 0, 0.1, 0.06); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  // head with big eyes
  ctx.fillStyle = P.eye; ellipse(ctx, 0.31, 0, 0.06, 0.07); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  if (lod >= 3) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ellipse(ctx, 0.3, -0.03, 0.015, 0.012); ctx.fill(); ellipse(ctx, 0.3, 0.03, 0.015, 0.012); ctx.fill(); }
}

function frog(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  const hop = o.hop != null ? o.hop : 0;      // 0 sitting, 1 legs stretched mid-leap
  const throat = 0.5 + 0.5 * Math.sin(t * 2.5 + ph);
  const green = '#6c7f2b', light = '#9db24b', dark = '#3d4a16', belly = '#cfd0a0';
  const fill = shade(ctx, lod, 'frog', -0.05, 0, 0.35, light, green, dark);
  // hind legs: folded Z when sitting, stretched back when hopping
  const legs = () => {
    for (const s of [1, -1]) {
      ctx.beginPath();
      const kx = lerp(-0.1, -0.35, hop), ky = s * lerp(0.3, 0.2, hop);
      const fx = lerp(0.12, -0.58, hop), fy = s * lerp(0.32, 0.12, hop);
      ctx.moveTo(-0.2, s * 0.16);
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.lineTo(fx + 0.06, fy + s * 0.05);
      ctx.moveTo(fx, fy); ctx.lineTo(fx - 0.03, fy + s * 0.07);
      ctx.moveTo(fx, fy); ctx.lineTo(fx + 0.08, fy - s * 0.01);
      ctx.stroke();
      // front legs
      ctx.beginPath(); ctx.moveTo(0.15, s * 0.14); ctx.lineTo(0.26, s * 0.26); ctx.lineTo(0.34, s * 0.24); ctx.moveTo(0.26, s * 0.26); ctx.lineTo(0.3, s * 0.32); ctx.stroke();
    }
  };
  if (lod === 0) {
    ctx.fillStyle = green;
    ellipse(ctx, -0.02, 0, 0.36, 0.24); ctx.fill();
    return;
  }
  ctx.strokeStyle = green; ctx.lineWidth = 0.075; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  legs();
  if (lod >= 2) { ctx.strokeStyle = INK; ctx.lineWidth = 0.075 + lineW(o) * 2; ctx.globalCompositeOperation = 'destination-over'; legs(); ctx.globalCompositeOperation = 'source-over'; }
  // body
  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(0.36, 0);
    ctx.quadraticCurveTo(0.34, -0.2, 0.1, -0.22);
    ctx.quadraticCurveTo(-0.3, -0.26, -0.38, 0);
    ctx.quadraticCurveTo(-0.3, 0.26, 0.1, 0.22);
    ctx.quadraticCurveTo(0.34, 0.2, 0.36, 0);
    ctx.closePath();
  };
  ctx.fillStyle = fill; bodyPath(); ctx.fill();
  if (lod >= 2) {
    // dorsal stripe and spots
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.moveTo(0.2, -0.015); ctx.lineTo(-0.36, -0.01); ctx.lineTo(-0.36, 0.01); ctx.lineTo(0.2, 0.015); ctx.fill();
    ctx.fillStyle = dark;
    const spots = [[-0.2, 0.1, 0.04], [-0.05, -0.12, 0.035], [-0.25, -0.09, 0.03], [0.05, 0.12, 0.03], [-0.12, 0.17, 0.025]];
    for (const [x, y, r] of spots) { ellipse(ctx, x, y, r, r * 0.8); ctx.fill(); }
  }
  if (lod >= 2) { ink(ctx, o); bodyPath(); ctx.stroke(); }
  // throat (seen from above as a lighter crescent at the chin)
  if (lod >= 2) { ctx.fillStyle = belly; ctx.globalAlpha *= 0.35 + throat * 0.3; ellipse(ctx, 0.3, 0, 0.05 + throat * 0.015, 0.09); ctx.fill(); ctx.globalAlpha /= 0.35 + throat * 0.3; }
  // eyes
  for (const s of [1, -1]) {
    ctx.fillStyle = lod >= 3 ? radial(ctx, 'frog-eye', 0, 0, 0.01, 0, 0, 0.08, [[0, '#f0d070'], [0.7, '#b8862a'], [1, '#5a4010']]) : '#c9962e';
    ctx.save(); ctx.translate(0.2, s * 0.15);
    ellipse(ctx, 0, 0, 0.065, 0.065); ctx.fill();
    if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); ctx.fillStyle = '#120c08'; ellipse(ctx, 0.01, 0, 0.04, 0.018, s * 0.3); ctx.fill(); }
    if (lod >= 3) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ellipse(ctx, -0.02, -s * 0.03, 0.015, 0.015); ctx.fill(); }
    ctx.restore();
  }
}

const FISH_PALETTES = {
  silver: { key: 'fish-s', back: '#55646e', mid: '#9aa5ab', belly: '#dcd9cf', fin: '#c4653a', finDark: '#8a3f22' },
  gold: { key: 'fish-g', back: '#b6652a', mid: '#e09a4a', belly: '#f3d9a0', fin: '#c24a2a', finDark: '#7a2a16' },
  dark: { key: 'fish-d', back: '#2a2f33', mid: '#4f585e', belly: '#8b9398', fin: '#5a3a2e', finDark: '#2a1a14' },
};

function fish(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const P = FISH_PALETTES[o.palette as keyof typeof FISH_PALETTES] || FISH_PALETTES.silver;
  const ph = o.phase || 0;
  const wag = (o.wag != null ? o.wag : 1) * Math.sin(TAU * 3 * t + ph) * 0.22;
  const bend = (o.bend || 0) * 0.6 + wag;
  // spine: y(x) bends toward the tail
  const sy = (x: number) => (x < 0 ? bend * x * x * 0.9 : 0) - 0.0;
  const top = (x: number) => sy(x) - h(x), bot = (x: number) => sy(x) + h(x);
  const h = (x: number) => 0.14 * Math.sqrt(Math.max(0, 1 - ((x - 0.02) / 0.5) ** 2)) * (x < -0.35 ? Math.max(0.25, (x + 0.5) / 0.15) : 1);
  const step = lod >= 2 ? 0.06 : 0.14;
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(0.48, sy(0.48));
    for (let x = 0.44; x >= -0.42; x -= step) ctx.lineTo(x, top(x));
    ctx.lineTo(-0.44, sy(-0.44));
    for (let x = -0.42; x <= 0.44; x += step) ctx.lineTo(x, bot(x));
    ctx.closePath();
  };
  const tailFin = () => {
    const bx = -0.42, by = sy(bx);
    const dy = bend * -0.8 * 0.06;
    ctx.beginPath();
    ctx.moveTo(bx, by - 0.03);
    ctx.quadraticCurveTo(-0.5, by - 0.14 + dy, -0.58, by - 0.17 + dy * 2);
    ctx.quadraticCurveTo(-0.52, by, -0.58, by + 0.17 + dy * 2);
    ctx.quadraticCurveTo(-0.5, by + 0.14 + dy, bx, by + 0.03);
    ctx.closePath();
  };
  if (lod === 0) {
    ctx.fillStyle = P.mid;
    body(); ctx.fill(); tailFin(); ctx.fill();
    return;
  }
  const finFill = lod >= 3 ? P.fin : P.fin;
  // fins behind the body first
  ctx.fillStyle = finFill;
  tailFin(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  // dorsal
  ctx.beginPath(); ctx.moveTo(0.12, top(0.12)); ctx.quadraticCurveTo(-0.02, top(0) - 0.14, -0.2, top(-0.2) - 0.06); ctx.lineTo(-0.2, top(-0.2)); ctx.closePath(); ctx.fill();
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.stroke(); }
  // pelvic / anal
  if (lod >= 2) {
    ctx.beginPath(); ctx.moveTo(-0.05, bot(-0.05)); ctx.lineTo(-0.16, bot(-0.12) + 0.09); ctx.lineTo(-0.22, bot(-0.22)); ctx.closePath(); ctx.fill();
    ink(ctx, o, 0.8); ctx.stroke();
  }
  // body
  ctx.fillStyle = lod >= 3
    ? linear(ctx, 'fishb-' + P.key, 0, -0.14, 0, 0.14, [[0, P.back], [0.45, P.mid], [1, P.belly]])
    : (lod >= 1 ? P.mid : P.back);
  body(); ctx.fill();
  if (lod >= 1 && lod < 3) {
    ctx.fillStyle = P.back;
    ctx.beginPath();
    ctx.moveTo(0.44, sy(0.44) - 0.02);
    for (let x = 0.38; x >= -0.42; x -= step) ctx.lineTo(x, top(x) + 0.01);
    for (let x = -0.42; x <= 0.44; x += step) ctx.lineTo(x, sy(x) - 0.03);
    ctx.closePath(); ctx.fill();
  }
  if (lod >= 2) { ink(ctx, o); body(); ctx.stroke(); }
  if (lod >= 3) {
    // scales: short arcs
    ctx.save(); body(); ctx.clip();
    ctx.strokeStyle = 'rgba(40,30,20,0.22)'; ctx.lineWidth = lineW(o, 0.7);
    for (let row = -2; row <= 2; row++) {
      for (let i = 0; i < 7; i++) {
        const x = 0.2 - i * 0.08 - (row % 2 ? 0.04 : 0), y = sy(x) + row * 0.05;
        ctx.beginPath(); ctx.arc(x, y, 0.035, -0.4 + Math.PI * 0.5, 0.4 + Math.PI * 0.5); ctx.stroke();
      }
    }
    ctx.restore();
    // belly sheen
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ellipse(ctx, 0.1, 0.05, 0.22, 0.04); ctx.fill();
  }
  // pectoral fin
  if (lod >= 2) {
    ctx.fillStyle = finFill;
    ctx.beginPath(); ctx.moveTo(0.18, 0.03); ctx.quadraticCurveTo(0.08, 0.1, 0.0, 0.14); ctx.quadraticCurveTo(0.1, 0.09, 0.16, 0.08); ctx.closePath(); ctx.fill();
    ink(ctx, o, 0.7); ctx.stroke();
  }
  // gill
  if (lod >= 2) { ink(ctx, o, 0.8, true); ctx.beginPath(); ctx.moveTo(0.3, -0.09); ctx.quadraticCurveTo(0.24, 0, 0.3, 0.09); ctx.stroke(); }
  // mouth
  if (lod >= 2) { ink(ctx, o, 0.8); ctx.beginPath(); ctx.moveTo(0.48, 0.0); ctx.lineTo(0.4, 0.02); ctx.stroke(); }
  eye(ctx, lod, 0.36, -0.04, 0.025, lod >= 3 ? '#e9dcae' : null);
}

// ---------------------------------------------------------------------------
// Hell
// ---------------------------------------------------------------------------

function bat(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  const freq = 4.5;
  const { up, glide } = flapState(t, o, freq, 0.25);
  const k = Math.cos(up * 1.1);
  const span = 0.62;
  const bob = (1 - glide) * Math.sin(TAU * freq * t + ph) * 0.03;
  const dark = '#1e1512';
  const memb = lod >= 3 ? radial(ctx, 'bat-memb', 0, 0, 0.1, 0, 0, 0.7, [[0, '#4a2c20'], [0.6, '#2e1b14'], [1, '#17100c']]) : '#2a1a14';
  ctx.save();
  ctx.translate(0, bob);
  const wing = (s: number) => {
    const ty = s * span * k;
    const wx = 0.22, wy = s * span * 0.45 * k; // wrist
    ctx.moveTo(0.12, s * 0.07);
    ctx.quadraticCurveTo(0.26, s * 0.12 + wy * 0.3, wx, wy);
    ctx.quadraticCurveTo(0.14, ty * 0.8, -0.02, ty);            // finger 1 to tip
    // ragged trailing edge: three scallops back to the body
    ctx.quadraticCurveTo(-0.12, ty * 0.78, -0.16, ty * 0.68);
    ctx.quadraticCurveTo(-0.2, ty * 0.5, -0.22, ty * 0.42);
    ctx.quadraticCurveTo(-0.28, ty * 0.26, -0.26, ty * 0.18);
    ctx.quadraticCurveTo(-0.3, s * 0.08, -0.2, s * 0.06);
    ctx.closePath();
  };
  if (lod === 0) {
    ctx.fillStyle = dark;
    ctx.beginPath(); wing(1); wing(-1); ctx.fill();
    ellipse(ctx, 0.02, 0, 0.3, 0.1); ctx.fill();
    ctx.restore();
    return;
  }
  ctx.fillStyle = memb;
  ctx.beginPath(); wing(1); wing(-1); ctx.fill();
  if (lod >= 2) {
    ctx.strokeStyle = 'rgba(190,130,70,0.45)'; ctx.lineWidth = lineW(o, 2); ctx.lineJoin = 'round'; ctx.stroke();
    ink(ctx, o, 0.9); ctx.stroke();
  }
  if (lod >= 2) {
    // finger bones
    ctx.strokeStyle = 'rgba(70,45,35,0.9)'; ctx.lineWidth = lineW(o, 1.3);
    for (const s of [1, -1]) {
      const ty = s * span * k;
      const wx = 0.22, wy = s * span * 0.45 * k;
      ctx.beginPath();
      ctx.moveTo(0.12, s * 0.07); ctx.lineTo(wx, wy);
      ctx.moveTo(wx, wy); ctx.lineTo(-0.02, ty);
      ctx.moveTo(wx, wy); ctx.lineTo(-0.16, ty * 0.68);
      ctx.moveTo(wx, wy); ctx.lineTo(-0.22, ty * 0.42);
      ctx.stroke();
    }
  }
  // body, head, ears, tail
  ctx.fillStyle = lod >= 3 ? radial(ctx, 'bat-body', 0.05, -0.03, 0.01, 0.02, 0, 0.3, [[0, '#4a2e22'], [0.6, '#241612'], [1, '#120a08']]) : dark;
  ellipse(ctx, 0.0, 0, 0.28, 0.1); ctx.fill();
  if (lod >= 2) { ink(ctx, o); ctx.stroke(); }
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(-0.24, -0.03); ctx.quadraticCurveTo(-0.45, -0.02, -0.5, 0.08); ctx.quadraticCurveTo(-0.44, 0.0, -0.24, 0.03); ctx.closePath(); ctx.fill(); // hooked tail
  ellipse(ctx, 0.32, 0, 0.1, 0.085); ctx.fill();
  if (lod >= 2) { ink(ctx, o); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0.3, -0.07); ctx.lineTo(0.3, -0.2); ctx.lineTo(0.38, -0.08); // ears
  ctx.moveTo(0.3, 0.07); ctx.lineTo(0.3, 0.2); ctx.lineTo(0.38, 0.08); ctx.closePath(); ctx.fill();
  if (lod >= 3) { ink(ctx, o, 0.8); ctx.stroke(); }
  if (lod >= 2) {
    // ember eyes
    ctx.fillStyle = '#e8a23a';
    ellipse(ctx, 0.36, -0.035, 0.018, 0.014); ctx.fill();
    ellipse(ctx, 0.36, 0.035, 0.018, 0.014); ctx.fill();
  }
  if (lod >= 3) {
    // little claws at the wrists
    ink(ctx, o, 0.9);
    for (const s of [1, -1]) { const wy = s * span * 0.45 * k; ctx.beginPath(); ctx.moveTo(0.22, wy); ctx.lineTo(0.3, wy + s * 0.03); ctx.stroke(); }
  }
  ctx.restore();
}

function ember(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  const flick = 0.72 + 0.28 * Math.sin(TAU * 11 * t + ph) * Math.sin(TAU * 3.7 * t + ph * 2);
  const heat = o.heat != null ? o.heat : 1; // 1 fresh, 0 dying
  const core = heat > 0.5 ? '#fff2b0' : '#ffb060';
  const glow = `rgba(255,${Math.round(120 + 80 * heat)},${Math.round(30 * heat)},`;
  ctx.save();
  ctx.globalAlpha *= flick;
  if (lod >= 1) {
    ctx.fillStyle = radial(ctx, 'ember-glow', 0, 0, 0, 0, 0, 0.5, [[0, 'rgba(255,170,60,0.55)'], [0.4, 'rgba(255,110,30,0.18)'], [1, 'rgba(255,80,20,0)']]);
    ellipse(ctx, 0, 0, 0.5, 0.5); ctx.fill();
  }
  ctx.fillStyle = glow + '0.95)';
  ellipse(ctx, 0, 0, 0.14, 0.14); ctx.fill();
  ctx.fillStyle = core;
  ellipse(ctx, 0, 0, 0.07 * (0.8 + heat * 0.4), 0.07); ctx.fill();
  if (lod >= 2 && o.trail !== false) {
    // short streak behind (caller orients +x along velocity)
    ctx.fillStyle = glow + '0.45)';
    ctx.beginPath(); ctx.moveTo(-0.06, -0.05); ctx.lineTo(-0.5, 0); ctx.lineTo(-0.06, 0.05); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function smoke(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = (o.phase || 0) * 7;
  // age 0..1: grows and fades (caller passes o.age, or it is derived from t over o.life)
  const life = o.life || 4;
  const age = o.age != null ? o.age : ((t % life) + life) % life / life;
  const r = 0.25 + age * 0.75;
  const a = (1 - age) * (0.35 + 0.35 * (1 - age)) * (lod === 0 ? 1.2 : 1);
  const col = o.palette === 'warm' ? '150,120,100' : o.palette === 'pale' ? '190,185,178' : '120,112,105';
  ctx.save();
  ctx.globalAlpha *= clamp(a, 0, 1);
  if (lod === 0) { ctx.fillStyle = `rgba(${col},0.7)`; ellipse(ctx, 0, 0, r * 0.7, r * 0.7); ctx.fill(); ctx.restore(); return; }
  ctx.fillStyle = radial(ctx, 'smoke-' + col, 0, 0, 0, 0, 0, 1, [[0, `rgba(${col},0.55)`], [0.6, `rgba(${col},0.22)`], [1, `rgba(${col},0)`]]);
  const puffs = lod >= 2 ? 4 : 1;
  for (let i = 0; i < puffs; i++) {
    const ang = ph + i * 2.1 + t * 0.3;
    const d = (i === 0 ? 0 : 0.25) * r;
    const pr = r * (i === 0 ? 1 : 0.6 + 0.1 * i);
    ctx.save();
    ctx.translate(Math.cos(ang) * d, Math.sin(ang) * d);
    ctx.scale(pr, pr * (0.85 + 0.15 * Math.sin(ang)));
    ellipse(ctx, 0, 0, 1, 1); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function ash(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  ctx.save();
  ctx.rotate(t * 1.7 + ph);
  ctx.scale(1, 0.4 + 0.6 * Math.abs(Math.sin(t * 2.3 + ph))); // tumbling flake
  ctx.fillStyle = lod >= 2
    ? radial(ctx, 'ash-' + (o.palette || 'grey'), -0.1, -0.1, 0.02, 0, 0, 0.55, o.palette === 'glow' ? [[0, '#a07050'], [0.6, '#5a3a28'], [1, '#2a1a12']] : [[0, '#8a847c'], [0.6, '#5e5852'], [1, '#2e2a26']])
    : (o.palette === 'glow' ? '#8a5a3a' : '#6e6862');
  ctx.beginPath();
  if (lod >= 2) { ctx.moveTo(0.5, 0); ctx.lineTo(0.3, 0.18); ctx.lineTo(0.1, 0.4); ctx.lineTo(-0.12, 0.28); ctx.lineTo(-0.5, 0.1); ctx.lineTo(-0.34, -0.12); ctx.lineTo(-0.2, -0.4); ctx.lineTo(0.08, -0.22); }
  else { ctx.moveTo(0.5, 0); ctx.lineTo(0.1, 0.4); ctx.lineTo(-0.5, 0.1); ctx.lineTo(-0.2, -0.4); }
  ctx.closePath(); ctx.fill();
  if (lod >= 2) { ctx.fillStyle = 'rgba(20,16,14,0.5)'; ctx.beginPath(); ctx.moveTo(0.1, 0.0); ctx.lineTo(-0.3, 0.1); ctx.lineTo(-0.1, -0.3); ctx.closePath(); ctx.fill(); }
  if (lod >= 2 && o.palette === 'glow') { ctx.fillStyle = 'rgba(255,120,40,0.7)'; ellipse(ctx, 0.3, 0.05, 0.1, 0.08); ctx.fill(); }
  ctx.restore();
}

/**
 * Shaft of light from the origin along +x, length 1. Options: width (at the far end,
 * default 0.35), color, dust (count of motes inside, default 14 at lod>=2).
 */
function lightBeam(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  const W = o.width || 0.35;
  const breathe = 0.9 + 0.1 * Math.sin(t * 0.8 + ph);
  const col = o.color || '230,220,170';
  ctx.save();
  ctx.globalAlpha *= breathe;
  ctx.globalCompositeOperation = o.blend || 'lighter';
  const g = gradFor(ctx, 'beam-' + col + W, (c) => {
    const gg = c.createLinearGradient(0, 0, 1, 0);
    gg.addColorStop(0, `rgba(${col},0.55)`); gg.addColorStop(0.5, `rgba(${col},0.22)`); gg.addColorStop(1, `rgba(${col},0)`);
    return gg;
  });
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, -0.02); ctx.lineTo(1, -W); ctx.lineTo(1, W); ctx.lineTo(0, 0.02); ctx.closePath(); ctx.fill();
  if (lod >= 1) {
    // soft cross falloff: a brighter core band
    const g2 = gradFor(ctx, 'beam-core-' + col, (c) => {
      const gg = c.createLinearGradient(0, 0, 1, 0);
      gg.addColorStop(0, `rgba(${col},0.35)`); gg.addColorStop(1, `rgba(${col},0)`);
      return gg;
    });
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.moveTo(0, -0.01); ctx.lineTo(1, -W * 0.35); ctx.lineTo(1, W * 0.35); ctx.lineTo(0, 0.01); ctx.closePath(); ctx.fill();
  }
  if (lod >= 2) {
    // drifting dust inside the beam
    const n = o.dust != null ? o.dust : lod >= 3 ? 18 : 8;
    ctx.fillStyle = `rgba(${col},0.8)`;
    for (let i = 0; i < n; i++) {
      const s0 = (i * 0.618 + ph * 0.1) % 1;
      const u = (s0 + t * 0.03 * (0.5 + (i % 3) * 0.3)) % 1;
      const v = Math.sin(i * 1.7 + t * 0.4) * 0.8;
      const x = u, y = v * W * u;
      const a = Math.sin(u * Math.PI) * (0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i)));
      ctx.globalAlpha = breathe * a;
      ellipse(ctx, x, y, 0.006, 0.006); ctx.fill();
    }
  }
  ctx.restore();
}

function flame(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  // flame rises toward -y; body length 1 = flame height. Facing +x is irrelevant; draw upright.
  const n1 = Math.sin(TAU * 9 * t + ph), n2 = Math.sin(TAU * 5.3 * t + ph * 1.3 + 1);
  const lean = n1 * 0.08 + n2 * 0.05;
  const hgt = 0.92 + n2 * 0.08 + n1 * 0.04;
  ctx.save();
  ctx.translate(0, 0.5);
  const tongue = (w: number, h: number, lx: number) => {
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(-w * 1.1, -h * 0.45, lx, -h);
    ctx.quadraticCurveTo(w * 1.1, -h * 0.45, w, 0);
    ctx.closePath();
  };
  if (lod >= 1) {
    ctx.globalCompositeOperation = o.blend || 'lighter';
    ctx.fillStyle = radial(ctx, 'flame-glow', 0, -0.3, 0, 0, -0.3, 0.9, [[0, 'rgba(255,150,50,0.35)'], [1, 'rgba(255,90,20,0)']]);
    ellipse(ctx, 0, -0.3, 0.9, 0.9); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = '#e8641e'; tongue(0.2, hgt, lean); ctx.fill();
  ctx.fillStyle = '#f7a52a'; tongue(0.14, hgt * 0.72, lean * 0.6); ctx.fill();
  if (lod >= 1) { ctx.fillStyle = '#fff0b8'; tongue(0.08, hgt * 0.42, lean * 0.3); ctx.fill(); }
  if (lod >= 2) { ctx.fillStyle = '#4a6fd8'; ctx.globalAlpha *= 0.5; ellipse(ctx, 0, -0.03, 0.09, 0.05); ctx.fill(); }
  ctx.restore();
}

function mote(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = (o.phase || 0) * 3.1;
  const glint = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(TAU * 0.9 * t + ph), 3);
  const col = o.palette === 'warm' ? '255,230,170' : o.palette === 'cool' ? '220,235,255' : '245,240,220';
  ctx.save();
  ctx.globalAlpha *= glint;
  ctx.fillStyle = `rgba(${col},0.9)`;
  ellipse(ctx, 0, 0, 0.18, 0.18); ctx.fill();
  if (lod >= 1) {
    ctx.fillStyle = radial(ctx, 'mote-' + col, 0, 0, 0, 0, 0, 0.5, [[0, `rgba(${col},0.5)`], [1, `rgba(${col},0)`]]);
    ellipse(ctx, 0, 0, 0.5, 0.5); ctx.fill();
  }
  if (lod >= 2 && glint > 0.7) {
    // four-point sparkle
    ctx.strokeStyle = `rgba(${col},${(glint - 0.7) * 2})`; ctx.lineWidth = 0.018; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.5, 0); ctx.lineTo(0.5, 0); ctx.moveTo(0, -0.5); ctx.lineTo(0, 0.5); ctx.stroke();
  }
  ctx.restore();
}

function droplet(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  // teardrop, tail toward -x (caller orients +x along velocity)
  ctx.save();
  const stretch = 1 + (o.speed || 0) * 0.3;
  ctx.scale(stretch, 1);
  const body = () => { ctx.beginPath(); ctx.moveTo(-0.5, 0); ctx.quadraticCurveTo(-0.1, -0.3, 0.2, -0.22); ctx.arc(0.2, 0, 0.26, -Math.PI / 2, Math.PI / 2); ctx.quadraticCurveTo(-0.1, 0.3, -0.5, 0); ctx.closePath(); };
  if (lod === 0) { ctx.fillStyle = 'rgba(200,225,240,0.85)'; body(); ctx.fill(); ctx.restore(); return; }
  ctx.fillStyle = lod >= 3
    ? radial(ctx, 'drop', 0.1, -0.1, 0.02, 0.15, 0, 0.4, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(185,215,235,0.75)'], [1, 'rgba(90,140,180,0.8)']])
    : 'rgba(185,215,235,0.8)';
  body(); ctx.fill();
  if (lod >= 2) { ctx.strokeStyle = 'rgba(40,70,100,0.6)'; ctx.lineWidth = lineW(o, 0.8); ctx.stroke(); }
  if (lod >= 2) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ellipse(ctx, 0.14, -0.1, 0.07, 0.04, -0.4); ctx.fill(); }
  ctx.restore();
}

function bubble(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const lod = lodOf(o);
  const ph = o.phase || 0;
  const wob = 1 + 0.06 * Math.sin(TAU * 2.3 * t + ph);
  ctx.save();
  ctx.scale(wob, 1 / wob);
  if (lod === 0) { ctx.strokeStyle = 'rgba(230,240,250,0.8)'; ctx.lineWidth = 0.12; ellipse(ctx, 0, 0, 0.42, 0.42); ctx.stroke(); ctx.restore(); return; }
  ctx.fillStyle = radial(ctx, 'bubble', 0, 0, 0.25, 0, 0, 0.5, [[0, 'rgba(255,255,255,0.03)'], [0.75, 'rgba(220,235,250,0.12)'], [1, 'rgba(240,250,255,0.75)']]);
  ellipse(ctx, 0, 0, 0.5, 0.5); ctx.fill();
  if (lod >= 2) { ctx.strokeStyle = 'rgba(40,70,100,0.5)'; ctx.lineWidth = lineW(o, 0.8); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ellipse(ctx, -0.17, -0.2, 0.1, 0.06, -0.7); ctx.fill();
  if (lod >= 2) { ellipse(ctx, 0.2, 0.22, 0.04, 0.03, -0.7); ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Bird wrappers (perched by default, o.pose = 'fly' for flight)
// ---------------------------------------------------------------------------

const GOLDFINCH: PerchPalette = {
  key: 'goldfinch', body: '#a9865a', bodyLight: '#cfae82', bodyDark: '#6d5438', belly: '#eadfc7', wing: '#211c18', wingDark: '#0f0c0a', head: '#eadfc7', crown: '#211c18', face: '#b8321f',
  beak: '#e3d6bb', beakLen: 0.09, legs: '#c9a08a', tail: '#211c18', tailLen: 0.28, tailBar: '#eadfc7',
  wingBars: [{ x0: 0.0, y0: -0.07, x1: -0.2, y1: 0.02, w: 0.05, color: '#e9c43a' }],
};
const KINGFISHER: PerchPalette = {
  key: 'kingfisher', body: '#c7702e', bodyLight: '#e9a062', bodyDark: '#8a4a1c', belly: '#c7702e', wing: '#2a7f9e', wingDark: '#154a60', head: '#1f6f86', headLight: '#3e9bb4', headDark: '#123e4d',
  eyeStripe: '#c7702e', beak: '#1c1a18', beakLen: 0.32, beakThin: true, legs: '#c0392b', tail: '#2a7f9e', tailLen: 0.14, tilt: -0.45, eyeRing: null,
  wingBars: [{ x0: 0.09, y0: -0.16, x1: -0.28, y1: 0.02, w: 0.035, color: '#5ad0e8' }],
  detail(ctx, lod, hx, hy) {
    if (lod < 2) return;
    ctx.fillStyle = '#f1ecd9'; // white throat and neck patch
    ellipse(ctx, hx + 0.03, hy + 0.1, 0.05, 0.03); ctx.fill();
    ellipse(ctx, hx - 0.1, hy + 0.04, 0.03, 0.025); ctx.fill();
    if (lod >= 3) { ctx.fillStyle = 'rgba(150,230,240,0.8)'; for (let i = 0; i < 6; i++) { ellipse(ctx, hx - 0.06 + i * 0.03, hy - 0.08 + (i % 2) * 0.025, 0.012, 0.008); ctx.fill(); } }
  },
};
const HOOPOE: PerchPalette = {
  key: 'hoopoe', body: '#cfa678', bodyLight: '#ead0ab', bodyDark: '#8f6c46', belly: '#e4d2b7', wing: '#1e1a16', wingDark: '#0f0c0a', head: '#cfa678', headLight: '#ead0ab', headDark: '#8f6c46',
  beak: '#2a2420', beakLen: 0.34, beakThin: true, beakCurve: true, legs: '#6a6a5a', tail: '#1e1a16', tailLen: 0.3, tailBar: '#f0e6d4',
  crest: { color: '#cfa678', tip: '#1e1a16' },
  wingBars: [
    { x0: 0.04, y0: -0.1, x1: -0.22, y1: 0.03, w: 0.035, color: '#f0e6d4' },
    { x0: -0.02, y0: -0.03, x1: -0.26, y1: 0.07, w: 0.03, color: '#f0e6d4' },
  ],
};

function perchOrFly(perched: PerchPalette, flyP: FlyPalette): SpriteDraw {
  return (ctx, t, o) => (o.pose === 'fly' ? flyingBird(ctx, t, o, flyP) : perchedBird(ctx, t, o, perched));
}

function songbird(ctx: CanvasRenderingContext2D, t: number, o: SpriteOptions): void {
  const P = SONGBIRD_PALETTES[o.palette as keyof typeof SONGBIRD_PALETTES] || SONGBIRD_PALETTES.brown;
  if (o.pose === 'fly') return flyingBird(ctx, t, o, { ...FLY.songbirdFly, key: 'sbf-' + P.key, top: P.wing, belly: P.belly, head: P.head });
  return perchedBird(ctx, t, o, P);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** name -> { draw, tags: ['eden'|'garden'|'hell'|'all'], bg: 'meadow'|'water'|'night'|'sky', palettes?, poses? } */
interface SpriteDef { draw: SpriteDraw; tags: string[]; bg: string; kind: string; palettes?: string[]; poses?: string[] }
export const sprites = {
  // Eden
  blackbird: { draw: (c, t, o) => flyingBird(c, t, o, FLY.blackbird), tags: ['eden'], bg: 'sky', kind: 'flyer' },
  swan: { draw: swan, tags: ['eden'], bg: 'water', kind: 'swimmer' },
  duck: { draw: duck, tags: ['eden', 'garden'], bg: 'water', kind: 'swimmer', palettes: Object.keys(DUCK_PALETTES) },
  heron: { draw: heron, tags: ['eden'], bg: 'water', kind: 'stander', palettes: Object.keys(HERON_PALETTES) },
  butterfly: { draw: butterfly, tags: ['eden', 'garden'], bg: 'meadow', kind: 'insect', palettes: Object.keys(BUTTERFLY_PALETTES) },
  dragonfly: { draw: dragonfly, tags: ['eden', 'garden'], bg: 'water', kind: 'insect', palettes: Object.keys(DRAGONFLY_PALETTES) },
  frog: { draw: frog, tags: ['eden'], bg: 'meadow', kind: 'hopper' },
  // Garden
  goldfinch: { draw: perchOrFly(GOLDFINCH, FLY.goldfinchFly), tags: ['garden'], bg: 'meadow', kind: 'bird', poses: ['perch', 'fly'] },
  kingfisher: { draw: perchOrFly(KINGFISHER, FLY.kingfisherFly), tags: ['garden'], bg: 'water', kind: 'bird', poses: ['perch', 'fly'] },
  hoopoe: { draw: perchOrFly(HOOPOE, FLY.hoopoeFly), tags: ['garden'], bg: 'meadow', kind: 'bird', poses: ['perch', 'fly'] },
  swallow: { draw: (c, t, o) => flyingBird(c, t, o, FLY.swallow), tags: ['garden'], bg: 'sky', kind: 'flyer' },
  fish: { draw: fish, tags: ['garden', 'eden'], bg: 'water', kind: 'swimmer', palettes: Object.keys(FISH_PALETTES) },
  songbird: { draw: songbird, tags: ['garden', 'eden'], bg: 'meadow', kind: 'bird', palettes: Object.keys(SONGBIRD_PALETTES), poses: ['perch', 'fly'] },
  droplet: { draw: droplet, tags: ['garden'], bg: 'water', kind: 'particle' },
  bubble: { draw: bubble, tags: ['garden'], bg: 'water', kind: 'particle' },
  // Hell
  bat: { draw: bat, tags: ['hell'], bg: 'night', kind: 'flyer' },
  raven: { draw: (c, t, o) => flyingBird(c, t, o, FLY.raven), tags: ['hell'], bg: 'night', kind: 'flyer' },
  ember: { draw: ember, tags: ['hell'], bg: 'night', kind: 'particle' },
  smoke: { draw: smoke, tags: ['hell'], bg: 'night', kind: 'particle', palettes: ['grey', 'warm', 'pale'] },
  ash: { draw: ash, tags: ['hell'], bg: 'night', kind: 'particle', palettes: ['grey', 'glow'] },
  lightBeam: { draw: lightBeam, tags: ['hell'], bg: 'night', kind: 'light' },
  flame: { draw: flame, tags: ['hell'], bg: 'night', kind: 'particle' },
  // Everywhere
  mote: { draw: mote, tags: ['all'], bg: 'meadow', kind: 'particle', palettes: ['warm', 'cool', 'plain'] },
} satisfies Record<string, SpriteDef>;

export type SpriteName = keyof typeof sprites;
export const spriteNames = Object.keys(sprites) as SpriteName[];

/**
 * Draw sprite `name` at the current transform.
 * Styles (fillStyle, strokeStyle, lineWidth, globalAlpha) are left modified; wrap in
 * save/restore if that matters to the caller.
 */
export function drawSprite(ctx: CanvasRenderingContext2D, name: SpriteName, t: number, o: SpriteOptions = {}): void {
  const s = sprites[name];
  if (!s) throw new Error('unknown sprite: ' + name);
  s.draw(ctx, t, o);
}

/**
 * Convenience: draw a motion item ({x, y, angle, scale, t, alpha}) with a sprite at
 * `bodyPx` screen pixels per unit scale, in the caller's current coordinate space.
 */
// What drawItem places: a motion item, or any object with a position and an alpha.
export interface Placed { x: number; y: number; alpha: number; angle?: number; scale?: number; t?: number; phase?: number; flipX?: boolean; flipY?: boolean }
export function drawItem(ctx: CanvasRenderingContext2D, name: SpriteName, item: Placed, size: number, o: SpriteOptions = {}): void {
  if (item.alpha <= 0) return;
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.angle || 0);
  const s = size * (item.scale || 1);
  ctx.scale(s, s);
  if (item.alpha != null && item.alpha < 1) ctx.globalAlpha *= item.alpha;
  if (item.flipX) ctx.scale(-1, 1);
  if (item.flipY) ctx.scale(1, -1);
  const opts = o.px == null ? { ...o, px: s * (o.pxPerUnit || 1), phase: item.phase } : { ...o, phase: item.phase };
  sprites[name].draw(ctx, item.t || 0, opts);
  ctx.restore();
}
