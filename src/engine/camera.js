// Pan/zoom camera over the painting, with inertia, smooth zoom, elastic edges and
// van Wijk-Nuij flights to stories. Units: world px (source scan), CSS px on screen.
import { WORLD_W, WORLD_H } from '../world.js';

const MAX_SCALE = 2.0; // CSS px per world px: deep brushwork
const RHO = 1.4;

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
  }

  get fitScale() { return Math.min(this.w / (WORLD_W * 1.04), this.h / (WORLD_H * 1.06)); }
  get minScale() { return this.fitScale * 0.1; } // an infinite board: the triptych can shrink to an object on it
  get maxScale() { return MAX_SCALE; }

  resize(w, h) {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    if (!this.interacted || !(this.scale >= this.minScale)) this.fit();
    this.clamp(true);
  }

  fit() { this.cx = WORLD_W / 2; this.cy = WORLD_H / 2; this.scale = this.fitScale; }

  screenToWorld(sx, sy) {
    return [this.cx + (sx - this.w / 2) / this.scale, this.cy + (sy - this.h / 2) / this.scale];
  }
  worldToScreen(wx, wy) {
    return [(wx - this.cx) * this.scale + this.w / 2, (wy - this.cy) * this.scale + this.h / 2];
  }
  // Visible world rect.
  view() {
    const hw = this.w / 2 / this.scale, hh = this.h / 2 / this.scale;
    return { x0: this.cx - hw, y0: this.cy - hh, x1: this.cx + hw, y1: this.cy + hh };
  }

  panBy(dx, dy) {
    this.flight = null;
    this.interacted = true;
    let fx = 1, fy = 1;
    if (this.dragging) { // rubber band past the edges
      const o = this.overshoot();
      fx = 1 / (1 + Math.abs(o.x) * this.scale / 120);
      fy = 1 / (1 + Math.abs(o.y) * this.scale / 120);
    }
    this.cx -= dx / this.scale * fx;
    this.cy -= dy / this.scale * fy;
    this.emit();
  }

  zoomAt(factor, sx, sy, smooth = true) {
    this.flight = null;
    this.interacted = true;
    const base = this.zoomTarget ? this.zoomTarget.scale : this.scale;
    const target = Math.max(this.minScale, Math.min(this.maxScale, base * factor));
    if (!smooth) { this.applyZoom(target, sx, sy); this.zoomTarget = null; return; }
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

  // The board is unbounded in feel: the view centre roams freely within a wide margin around
  // the painting and is only pulled back (elastically) when it wanders far beyond it.
  overshoot() {
    const mx = WORLD_W * 0.9, my = WORLD_H * 1.2;
    const ox = this.cx < -mx ? this.cx + mx : this.cx > WORLD_W + mx ? this.cx - WORLD_W - mx : 0;
    const oy = this.cy < -my ? this.cy + my : this.cy > WORLD_H + my ? this.cy - WORLD_H - my : 0;
    return { x: ox, y: oy };
  }

  clamp(hard = false, dt = 0.016) {
    const o = this.overshoot();
    if (!o.x && !o.y) return;
    const k = hard ? 1 : 1 - Math.exp(-dt * 12);
    this.cx -= o.x * k; this.cy -= o.y * k;
    if (o.x) this.vx *= 0.5;
    if (o.y) this.vy *= 0.5;
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
      if (!this.dragging) {
        const before = this.cx + this.cy;
        this.clamp(false, dt);
        if (this.cx + this.cy !== before) moved = true;
      }
    }
    if (moved) this.emit();
    return moved;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
}
