// Pan/zoom camera over the painting, with inertia, smooth zoom and van Wijk-Nuij flights to
// stories. Units: world px (source scan), CSS px on screen.
//
// The frame is fixed to the screen and only the painting moves inside it (Shahin, 2026-10-20).
// At rest the painting and its frame fill `box`, the screen under the navbar inside the margins;
// the frame and the board around it stay drawn at that rest view whatever the camera does. The
// camera zooms in from rest, never out of it, and is clamped so the frame's opening (the rest
// view of `framed`: the open triptych, or the centre panel with the wings shut) only ever shows
// painting. On an upright phone the frame hugs the box instead and the painting covers its
// opening, cropped at rest to the centre panel's middle (Shahin, 2026-10-20).
import { WORLD_W, WORLD_H } from '../world.js';

const MAX_SCALE = 2.0; // CSS px per world px: deep brushwork
const RHO = 1.4;
export const FRAME_W = 1500; // the frame's width, world px (post.js)

export class Camera {
  constructor() {
    this.w = 1; this.h = 1;
    this.cx = WORLD_W / 2; this.cy = WORLD_H / 2;
    this.scale = 0.01;
    this.vx = 0; this.vy = 0; // pan inertia, world px per second
    this.zoomTarget = null; // { scale, ax, ay } anchor in screen px
    this.flight = null;
    this.dragging = false;
    this.listeners = new Set();
    this.painting = { x0: 0, y0: 0, x1: WORLD_W, y1: WORLD_H }; // the framed triptych, world px
    this.framed = this.painting;
    this.box = null; // screen rect the framed painting fills at rest; null: the whole screen
    this.hug = false; // the frame is the box's edge, the painting cropped inside it
    this.rest = { cx: this.cx, cy: this.cy, scale: this.scale };
  }

  get fitScale() { return this.rest.scale; }
  get minScale() { return this.rest.scale; }
  get maxScale() { return MAX_SCALE; }

  resize(w, h) {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.layout();
  }

  // The triptych's painted rect, and the screen rect it rests in.
  setPainting(rect) { this.painting = rect; this.framed = rect; this.layout(); }
  setBox(box, hug = false) { this.box = box; this.hug = hug; this.layout(); }
  // What the opening shows: the triptych, or only the centre panel while the wings are shut.
  setFramed(rect) { this.framed = rect; this.clamp(); this.emit(); }

  layout() {
    const P = this.painting, b = this.box || { x0: 0, y0: 0, x1: this.w, y1: this.h };
    const sx = (b.x1 - b.x0) / (P.x1 - P.x0 + 2 * FRAME_W), sy = (b.y1 - b.y0) / (P.y1 - P.y0 + 2 * FRAME_W);
    // hugging, the triptych fills the opening's height and is cropped at the sides, centred on the
    // centre panel's middle: the cavalcade round the Pool of Youth just fits a phone's width
    const s = this.hug ? Math.max(sx, sy) : Math.min(sx, sy);
    this.rest = {
      scale: s,
      cx: (P.x0 + P.x1) / 2 - ((b.x0 + b.x1) / 2 - this.w / 2) / s,
      cy: (P.y0 + P.y1) / 2 - ((b.y0 + b.y1) / 2 - this.h / 2) / s,
    };
    if (!this.interacted || !(this.scale >= this.minScale)) this.fit();
    this.clamp();
    this.emit();
  }

  fit() { this.cx = this.rest.cx; this.cy = this.rest.cy; this.scale = this.rest.scale; }

  // The frame's opening on screen: the rest view of the framed rect, or inside the hugging frame.
  opening() {
    if (this.hug) { const b = this.box, f = FRAME_W * this.rest.scale; return { x0: b.x0 + f, y0: b.y0 + f, x1: b.x1 - f, y1: b.y1 - f }; }
    const r = this.rest, F = this.framed;
    return {
      x0: (F.x0 - r.cx) * r.scale + this.w / 2, y0: (F.y0 - r.cy) * r.scale + this.h / 2,
      x1: (F.x1 - r.cx) * r.scale + this.w / 2, y1: (F.y1 - r.cy) * r.scale + this.h / 2,
    };
  }
  inOpening(sx, sy) { const O = this.opening(); return sx >= O.x0 && sx <= O.x1 && sy >= O.y0 && sy <= O.y1; }

  screenToWorld(sx, sy) {
    return [this.cx + (sx - this.w / 2) / this.scale, this.cy + (sy - this.h / 2) / this.scale];
  }
  worldToScreen(wx, wy) {
    return [(wx - this.cx) * this.scale + this.w / 2, (wy - this.cy) * this.scale + this.h / 2];
  }
  // Visible world rect: what the frame's opening shows.
  view() {
    const O = this.opening();
    const [x0, y0] = this.screenToWorld(O.x0, O.y0), [x1, y1] = this.screenToWorld(O.x1, O.y1);
    return { x0, y0, x1, y1 };
  }

  panBy(dx, dy) {
    this.flight = null;
    this.interacted = true;
    this.cx -= dx / this.scale;
    this.cy -= dy / this.scale;
    this.clamp();
    this.emit();
  }

  zoomAt(factor, sx, sy, smooth = true) {
    this.flight = null;
    this.interacted = true;
    const base = this.zoomTarget ? this.zoomTarget.scale : this.scale;
    const target = Math.max(this.minScale, Math.min(this.maxScale, base * factor));
    if (!smooth) { this.applyZoom(target, sx, sy); this.zoomTarget = null; this.clamp(); this.emit(); return; }
    this.zoomTarget = { scale: target, ax: sx, ay: sy };
  }

  applyZoom(newScale, ax, ay) {
    const [wx, wy] = this.screenToWorld(ax, ay);
    this.scale = newScale;
    this.cx = wx - (ax - this.w / 2) / this.scale;
    this.cy = wy - (ay - this.h / 2) / this.scale;
    this.emit();
  }

  // Fly to a world point with a given scale (van Wijk & Nuij 2003).
  flyTo(cx, cy, scale, opts = {}) {
    scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
    const w0 = this.w / this.scale, w1 = this.w / scale;
    const ux0 = this.cx, uy0 = this.cy;
    const dx = cx - ux0, dy = cy - uy0, d2 = dx * dx + dy * dy, d1 = Math.sqrt(d2);
    let S, path;
    if (d1 < 1e-6) {
      S = Math.log(w1 / w0) / RHO;
      path = (s) => [ux0, uy0, w0 * Math.exp(RHO * s * S)];
    } else {
      const b0 = (w1 * w1 - w0 * w0 + RHO ** 4 * d2) / (2 * w0 * RHO ** 2 * d1);
      const b1 = (w1 * w1 - w0 * w0 - RHO ** 4 * d2) / (2 * w1 * RHO ** 2 * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S = (r1 - r0) / RHO;
      const cosh = (x) => (Math.exp(x) + Math.exp(-x)) / 2;
      const sinh = (x) => (Math.exp(x) - Math.exp(-x)) / 2;
      const tanh = (x) => sinh(x) / cosh(x);
      path = (s) => {
        const t = s * S;
        const coshr0 = cosh(r0);
        const u = w0 / (RHO ** 2 * d1) * (coshr0 * tanh(RHO * t + r0) - sinh(r0));
        return [ux0 + u * dx, uy0 + u * dy, w0 * coshr0 / cosh(RHO * t + r0)];
      };
    }
    const duration = opts.duration ?? Math.max(900, Math.min(4200, Math.abs(S) * 1000 * 0.85));
    this.zoomTarget = null; this.vx = this.vy = 0;
    this.flight = { t: 0, duration, path, done: opts.done };
  }

  // Keep the scale between rest and the deepest zoom, and the opening on the framed rect.
  // Returns whether the centre had to move.
  clamp() {
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale));
    const O = this.opening(), F = this.framed, s = this.scale;
    const fit = (c, f0, f1, o0, o1, mid) => {
      const lo = f0 - (o0 - mid) / s, hi = f1 - (o1 - mid) / s;
      return lo >= hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, c));
    };
    const cx = fit(this.cx, F.x0, F.x1, O.x0, O.x1, this.w / 2), cy = fit(this.cy, F.y0, F.y1, O.y0, O.y1, this.h / 2);
    const moved = cx !== this.cx || cy !== this.cy;
    if (cx !== this.cx) this.vx = 0;
    if (cy !== this.cy) this.vy = 0;
    this.cx = cx; this.cy = cy;
    return moved;
  }

  update(dt) {
    let moved = false;
    if (this.flight) {
      const f = this.flight;
      f.t += dt * 1000;
      const s = Math.min(1, f.t / f.duration);
      const e = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
      const [x, y, w] = f.path(e);
      this.cx = x; this.cy = y; this.scale = this.w / w;
      this.clamp(); // the flight's zoom-out arc stops at rest
      moved = true;
      if (s >= 1) { this.flight = null; f.done?.(); }
    } else {
      if (this.zoomTarget) {
        const z = this.zoomTarget;
        const k = 1 - Math.exp(-dt * 14);
        const ns = Math.exp(Math.log(this.scale) + (Math.log(z.scale) - Math.log(this.scale)) * k);
        this.applyZoom(ns, z.ax, z.ay);
        if (Math.abs(Math.log(z.scale / this.scale)) < 1e-3) { this.applyZoom(z.scale, z.ax, z.ay); this.zoomTarget = null; }
        moved = true;
      }
      if (!this.dragging && (Math.abs(this.vx) + Math.abs(this.vy)) * this.scale > 2) {
        this.cx += this.vx * dt; this.cy += this.vy * dt;
        const damp = Math.exp(-dt * 4.2);
        this.vx *= damp; this.vy *= damp;
        moved = true;
      } else if (!this.dragging) { this.vx = this.vy = 0; }
      if (this.clamp()) moved = true;
    }
    if (moved) this.emit();
    return moved;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
}
