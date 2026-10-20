// The living layer: creatures, water and fire particles drawn over the painting with
// Canvas2D, placed where Bosch put them. Positions are normalized triptych coordinates
// read off gridded crops of the painting.
import { drawItem } from '../life/sprites.js';
import { flock, swimPath, wander, particles, leap } from '../life/motion.js';
import { WORLD_W as W, WORLD_H as H } from '../world.js';

const P = (x, y) => ({ x: x * W, y: y * H });
const box = (x0, y0, x1, y1) => ({ x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H });
const poly = (pts) => pts.map(([x, y]) => [x * W, y * H]);

// A falling stream of drops from a spout to a landing point (parabola under gravity).
function stream(from, to, { rate = 12, g = 10000, seed = 1, size = 70 } = {}) {
  const dy = to.y - from.y;
  const T = Math.sqrt((2 * dy) / g);
  const vx = (to.x - from.x) / T;
  // lifetimes are randomized by the particle system, so give every drop time to reach
  // the water; drops are hidden below the waterline and ring the surface as they cross it
  return {
    group: particles({ emitter: { x: from.x, y: from.y, w: 30, h: 30 }, rate, life: T * 1.45, velocity: { x: vx, y: 0 }, gravity: g, spread: 0.05, seed, fade: 0.05, prewarm: 3, angleFromVelocity: true }),
    sprite: 'droplet', size, landing: to, rate,
  };
}

export class LifeLayer {
  constructor(canvas, camera, scene) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.enabled = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.rings = []; // splash rings on water
    this.groups = this.build();
  }

  build() {
    const G = [];
    const add = (group, sprite, size, extra = {}) => { G.push({ group, sprite, size, ...extra }); return group; };

    // ---------------- Eden ----------------
    // the flock that pours out of the rock and circles the sky
    add(flock({ count: 24, bounds: box(0.012, 0.025, 0.135, 0.2), home: P(0.058, 0.145), seed: 11, speed: 2100, tour: 16, stagger: 0.3, rest: 4 }), 'blackbird', 330, { layer: 1 });
    // the Fountain of Life: four thin jets from the discs into the pond (fountain2.jpg)
    for (const [i, [a, b]] of [
      [[0.1098, 0.309], [0.0960, 0.463]], [[0.1304, 0.308], [0.1440, 0.462]],
      [[0.1059, 0.364], [0.0932, 0.463]], [[0.1372, 0.364], [0.1483, 0.463]],
    ].entries()) {
      const s = stream(P(...a), P(...b), { seed: 30 + i, rate: 10 });
      G.push({ ...s, layer: 2, splash: true });
    }
    add(swimPath({ polygon: poly([[0.03, 0.47], [0.082, 0.47], [0.082, 0.55], [0.03, 0.55]]), speed: 260, seed: 5, count: 2, pause: 5 }), 'duck', 420, { layer: 1 });
    add(wander({ center: P(0.12, 0.79), radius: 6500, speed: 900, count: 4, seed: 3, jitter: 3, settle: 3 }), 'butterfly', 170, { layer: 2 });
    add(wander({ center: P(0.12, 0.28), radius: 7000, speed: 900, count: 3, seed: 4, jitter: 3, settle: 3 }), 'butterfly', 170, { layer: 2 });
    add(wander({ center: P(0.16, 0.452), radius: 3500, speed: 1600, count: 2, seed: 6, jitter: 0.8, dart: 1 }), 'dragonfly', 200, { layer: 2 });
    add(wander({ center: P(0.15, 0.885), radius: 3000, speed: 1500, count: 2, seed: 7, jitter: 0.8, dart: 1 }), 'dragonfly', 200, { layer: 2 });
    add(particles({ emitter: box(0.02, 0.2, 0.23, 0.42), rate: 3, life: 9, velocity: { x: 60, y: -40 }, spread: 3, wobble: 120, seed: 8, prewarm: 9, fade: 2, angleFromVelocity: false }), 'mote', 45, { layer: 2, opts: { palette: 'warm' } });

    // ---------------- Garden ----------------
    add(flock({ count: 11, bounds: box(0.27, 0.03, 0.73, 0.14), seed: 21, speed: 3800 }), 'swallow', 270, { layer: 1 });
    add(flock({ count: 6, bounds: box(0.33, 0.47, 0.67, 0.58), seed: 22, speed: 2200 }), 'goldfinch', 300, { layer: 1, opts: { pose: 'fly' } });
    // fish leap only where open water spans the whole arc (found by scanning the water mask
    // in public/data/effects.png, then checked on crops of each spot)
    for (const [i, [x, y, dx, h]] of [
      [0.548, 0.252, 0.010, 600], [0.451, 0.292, 0.008, 600],
      [0.160, 0.500, 0.010, 900], [0.144, 0.574, 0.010, 900],
    ].entries()) {
      add(leap({ from: P(x, y), to: P(x + dx, y), height: h, period: 8 + i * 1.7, seed: 40 + i, duration: 1.0,
        splash: (f) => this.splash(f.x, f.y, 220) }), 'fish', 520, { layer: 2 });
    }
    // bubbles surface in open water and break: a short rise, never across the figures above
    for (const [i, [x, y]] of [[0.556, 0.252], [0.455, 0.290], [0.168, 0.505], [0.150, 0.578]].entries()) {
      add(particles({ emitter: { x: x * W, y: y * H, w: 900, h: 250 }, rate: 0.7, life: 1.4, velocity: { x: 0, y: -110 }, spread: 0.5, wobble: 25, seed: 51 + i, prewarm: 2, fade: 0.4, angleFromVelocity: false }), 'bubble', 90, { layer: 2 });
    }
    // dust kicked up by the cavalcade
    for (const [i, b] of [box(0.40, 0.52, 0.62, 0.555), box(0.39, 0.355, 0.63, 0.38)].entries()) {
      add(particles({ emitter: b, rate: 5, life: 3.5, velocity: { x: 0, y: -160 }, spread: 1.2, wobble: 80, seed: 60 + i, prewarm: 3, fade: 1, grow: 1.8, angleFromVelocity: false }), 'mote', 110, { layer: 0, opts: { palette: 'warm' } });
    }
    add(wander({ center: P(0.62, 0.53), radius: 6000, speed: 900, count: 3, seed: 23, jitter: 3, settle: 3 }), 'butterfly', 170, { layer: 2 });
    add(wander({ center: P(0.35, 0.86), radius: 6500, speed: 900, count: 3, seed: 24, jitter: 3, settle: 3 }), 'butterfly', 170, { layer: 2 });
    add(wander({ center: P(0.68, 0.82), radius: 5000, speed: 900, count: 2, seed: 25, jitter: 3, settle: 3 }), 'butterfly', 170, { layer: 2 });
    // the Fountain of Adultery: two jets from the tower into the lake
    for (const [i, [a, b]] of [[[0.4778, 0.2081], [0.4755, 0.2434]], [[0.5333, 0.2111], [0.5355, 0.2443]]].entries()) {
      G.push({ ...stream(P(...a), P(...b), { seed: 70 + i, rate: 9, g: 9000 }), layer: 2, splash: true });
    }

    // ---------------- Hell ----------------
    // smoke over the burning city
    for (const [i, [x, y]] of [[0.85, 0.12], [0.93, 0.1], [0.79, 0.125], [0.975, 0.115]].entries()) {
      add(particles({ emitter: { x: x * W, y: y * H, w: 1500, h: 600 }, rate: 0.7, life: 10, velocity: { x: 120, y: -420 }, spread: 0.5, wobble: 200, grow: 3.4, seed: 80 + i, prewarm: 10, fade: 2.5, angleFromVelocity: false }), 'smoke', 1500, { layer: 0, opts: { palette: i % 2 ? 'warm' : 'grey' } });
    }
    // searchlights and the burst of light round the dark tower
    this.beams = [
      { from: P(0.955, 0.205), angle: Math.PI * 0.94, len: 9500, width: 1, sway: 0.08, speed: 0.13 },
      { from: P(0.862, 0.040), angle: Math.PI * 0.84, len: 7000, width: 1, sway: 0.03, speed: 0.07 },
      { from: P(0.856, 0.142), angle: -Math.PI * 0.62, len: 5200, width: 0.8, sway: 0.1, speed: 0.11 },
      { from: P(0.856, 0.142), angle: -Math.PI * 0.4, len: 4800, width: 0.8, sway: 0.1, speed: 0.09 },
    ];
    // embers rising from every fire
    for (const [i, [x, y]] of [[0.86, 0.105], [0.928, 0.105], [0.977, 0.118], [0.938, 0.145], [0.78, 0.13], [0.79, 0.30], [0.83, 0.155], [0.964, 0.24], [0.775, 0.175]].entries()) {
      add(particles({ emitter: { x: x * W, y: y * H, w: 900, h: 300 }, rate: 3.5, life: 2.6, velocity: { x: 60, y: -950 }, spread: 0.7, wobble: 160, grow: 0.4, seed: 90 + i, prewarm: 3, fade: 0.4, angleFromVelocity: false }), 'ember', 80, { layer: 3, blend: 'lighter' });
    }
    add(flock({ count: 7, bounds: box(0.775, 0.02, 0.99, 0.2), seed: 31, speed: 2600 }), 'bat', 420, { layer: 1 });
    add(flock({ count: 4, bounds: box(0.78, 0.26, 0.99, 0.46), seed: 32, speed: 2000 }), 'raven', 460, { layer: 1 });
    add(particles({ emitter: box(0.765, 0.0, 0.995, 0.04), rate: 2.2, life: 16, velocity: { x: 80, y: 900 }, spread: 0.6, wobble: 260, seed: 99, prewarm: 16, fade: 2, angleFromVelocity: false }), 'ash', 60, { layer: 3, opts: { palette: 'glow' } });

    // glass that catches the light (spheres.jpg, bell.jpg, fountain2.jpg)
    this.glass = [
      { c: P(0.3096, 0.6855), rx: 3480, ry: 4420, period: 9 },
      { c: P(0.6387, 0.5873), rx: 3120, ry: 3120, period: 11, dome: true },
      { c: P(0.1044, 0.3937), rx: 600, ry: 600, period: 6 },
      { c: P(0.1401, 0.3937), rx: 600, ry: 600, period: 7 },
    ];
    // still water where something stirs now and then
    this.stirs = [
      { poly: [[0.10, 0.89], [0.22, 0.885], [0.22, 0.965], [0.10, 0.965]], every: 2.5, r: 260 },
      { poly: [[0.03, 0.47], [0.085, 0.47], [0.085, 0.56], [0.03, 0.56]], every: 4, r: 200 },
      { poly: [[0.15, 0.47], [0.21, 0.47], [0.21, 0.565], [0.15, 0.565]], every: 4, r: 200 },
      { poly: [[0.45, 0.435], [0.56, 0.435], [0.56, 0.46], [0.45, 0.46]], every: 3, r: 220 },
      { poly: [[0.33, 0.29], [0.72, 0.29], [0.72, 0.325], [0.33, 0.325]], every: 2, r: 300 },
      { poly: [[0.26, 0.6], [0.45, 0.6], [0.45, 0.735], [0.26, 0.735]], every: 2.2, r: 260 },
    ].map((w) => ({ ...w, poly: poly(w.poly), next: Math.random() * w.every }));
    return G;
  }

  splash(x, y, r) { this.rings.push({ x, y, r, t: 0 }); if (this.rings.length > 60) this.rings.shift(); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr;
  }

  frame(dt, time) {
    this.resize();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.enabled) return;
    const c = this.camera, k = this.dpr, s = c.scale;
    // creatures stay inside the frame's opening
    const O = c.opening();
    const clip = `inset(${O.y0}px ${c.w - O.x1}px ${c.h - O.y1}px ${O.x0}px)`;
    if (clip !== this.clip) { this.canvas.style.clipPath = clip; this.clip = clip; }
    const v = c.view();
    const pad = (v.x1 - v.x0) * 0.15;
    const inView = (x, y, m = 0) => x > v.x0 - pad - m && x < v.x1 + pad + m && y > v.y0 - pad - m && y < v.y1 + pad + m;
    ctx.setTransform(k * s, 0, 0, k * s, k * (c.w / 2 - c.cx * s), k * (c.h / 2 - c.cy * s));

    // update everything (cheap), but only near groups at full rate
    for (const g of this.groups) {
      const it0 = g.group.items[0];
      const near = !it0 || g.group.items.some((it) => inView(it.x, it.y, 20000));
      g.near = near;
      if (near) g.group.update(dt);
      else if ((g.skip = (g.skip || 0) + dt) > 0.25) { g.group.update(g.skip); g.skip = 0; }
      if (g.landing && near) for (const it of g.group.items) {
        const below = it.y >= g.landing.y;
        if (below && !it.landed) { it.landed = true; if (Math.random() < 0.18) this.splash(it.x, g.landing.y, 140); }
        if (!below) it.landed = false;
      }
    }

    // beams (behind creatures)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.beams) {
      if (!inView(b.from.x, b.from.y, b.len)) continue;
      const a = b.angle + Math.sin(time * b.speed * Math.PI * 2) * b.sway;
      ctx.save();
      // the beam sprite starts at its origin and runs along +x for one unit
      ctx.translate(b.from.x, b.from.y); ctx.rotate(a); ctx.scale(b.len, b.len);
      ctx.globalAlpha = 0.6 + 0.25 * Math.sin(time * 1.7 + b.from.x);
      drawItem(ctx, 'lightBeam', { x: 0, y: 0, angle: 0, scale: 1, t: time, alpha: 1 }, 1, { px: b.len * s, width: 0.11 * b.width, color: '236,218,166' });
      ctx.restore();
    }
    ctx.restore();

    for (let layer = 0; layer <= 3; layer++) {
      for (const g of this.groups) {
        if ((g.layer ?? 1) !== layer || !g.near) continue;
        const px = g.size * s;
        if (px < 0.9) continue; // smaller than a pixel: leave it to the painting
        ctx.save();
        if (g.blend) ctx.globalCompositeOperation = g.blend;
        for (const it of g.group.items) {
          if (it.alpha <= 0.01 || !inView(it.x, it.y, g.size * 4)) continue;
          if (g.landing && it.y >= g.landing.y) continue;
          const per = g.sprite === 'smoke' ? { age: it.u ?? 0 } : g.sprite === 'ember' ? { heat: 1 - (it.u ?? 0) } : g.sprite === 'butterfly' || g.sprite === 'dragonfly' ? { rest: it.rest } : g.sprite === 'fish' ? { bend: it.bend } : null;
          drawItem(ctx, g.sprite, it, g.size, per ? { ...(g.opts || {}), ...per, pxPerUnit: s } : { ...(g.opts || {}), pxPerUnit: s });
        }
        ctx.restore();
      }
      if (layer === 2) {
        this.stir(dt, inView); this.drawRings(ctx, dt, s, inView); this.drawGlass(ctx, time, s, inView);
        this.animator?.draw(ctx, c, time, dt, this.pointer, inView, (x, y, r) => this.splash(x, y, r));
      }
    }
  }

  drawGlass(ctx, time, s, inView) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of this.glass) {
      if (g.rx * s < 6 || !inView(g.c.x, g.c.y, g.rx)) continue;
      const phase = (time / g.period) % 1;
      // a window reflection on the upper left, breathing, and a sparkle running along it
      const a0 = -2.55, a1 = -1.25;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = (0.05 + 0.03 * Math.sin(time * 0.8 + i)) * (1 - i * 0.25);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1 / s, g.rx * (0.05 - i * 0.012));
        ctx.beginPath();
        ctx.ellipse(g.c.x, g.c.y, g.rx * (0.86 - i * 0.05), g.ry * (0.86 - i * 0.05), 0, a0, a1);
        ctx.stroke();
      }
      const u = phase < 0.35 ? phase / 0.35 : -1;
      if (u >= 0) {
        const a = a0 + (a1 - a0) * u;
        const x = g.c.x + Math.cos(a) * g.rx * 0.86, y = g.c.y + Math.sin(a) * g.ry * 0.86;
        const r = g.rx * 0.07;
        const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.75)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = Math.sin(u * Math.PI);
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  stir(dt, inView) {
    for (const w of this.stirs) {
      w.next -= dt;
      if (w.next > 0) continue;
      w.next = w.every * (0.5 + Math.random());
      const xs = w.poly.map((p) => p[0]), ys = w.poly.map((p) => p[1]);
      const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
      const y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
      if (inView(x, y)) this.splash(x, y, w.r * (0.6 + Math.random() * 0.8));
    }
  }

  drawRings(ctx, dt, s, inView) {
    ctx.save();
    for (const r of this.rings) {
      r.t += dt;
      const u = r.t / 1.4;
      if (u >= 1 || !inView(r.x, r.y, 2000)) continue;
      ctx.globalAlpha = (1 - u) * (1 - u) * 0.4;
      ctx.strokeStyle = '#eef3f6';
      ctx.lineWidth = Math.max(1.2 / s, r.r * 0.12);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r * (0.4 + u * 2.2), r.r * (0.15 + u * 0.75), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.rings = this.rings.filter((r) => r.t < 1.4);
    ctx.restore();
  }
}
