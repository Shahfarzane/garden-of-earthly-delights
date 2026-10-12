// Motion behaviours for the living layer. Dependency-free, deterministic for a seed.
//
// Every behaviour returns { items, update(dt), time } where items is an array of
//   { x, y, angle, scale, t, kind, alpha, phase, vx, vy, ... }
// in the caller's units. The caller draws each item with the sprite of its choice
// (see drawItem in sprites.js). Angles are radians, 0 = facing +x, y grows downward.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** mulberry32: small seeded PRNG. Returns a function giving floats in [0,1). */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeItem(r, kind, extra) {
  return {
    x: 0, y: 0, angle: 0, scale: 0.85 + r() * 0.3, t: r() * 100, kind, alpha: 1,
    phase: r() * TAU, vx: 0, vy: 0, ...extra,
  };
}

function turnToward(angle, target, maxStep) {
  let d = target - angle;
  d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return angle + clamp(d, -maxStep, maxStep);
}

// ---------------------------------------------------------------------------
// flock: boids with optional stream-out-and-return from a home point
// ---------------------------------------------------------------------------

/**
 * flock({ count, bounds: {x, y, w, h}, home?: {x, y}, seed, speed?, neighbor?,
 *         separation?, tour?, release?, stagger? })
 * - bounds: soft box the flock is steered to stay inside.
 * - home: if given, birds start inside it (alpha 0), pour out one by one every
 *   `stagger` seconds, fly for about `tour` seconds, then stream back and vanish
 *   into it before the cycle repeats. Items carry `state`: 'inside' | 'out' | 'returning'.
 * - speed: cruise speed in caller units per second.
 */
export function flock(opts) {
  const {
    count = 30, bounds, home = null, seed = 1, speed = 60, neighbor = null,
    separation = null, tour = 14, stagger = 0.25, rest = 3,
  } = opts;
  const r = rng(seed);
  const diag = Math.hypot(bounds.w, bounds.h);
  const nbR = neighbor || diag * 0.12;
  const sepR = separation || nbR * 0.35;
  const items = [];
  for (let i = 0; i < count; i++) {
    const it = makeItem(r, 'bird', {});
    if (home) {
      it.x = home.x; it.y = home.y; it.alpha = 0; it.state = 'inside';
      it.timer = i * stagger + r() * stagger;
      it.tour = tour * (0.8 + r() * 0.4);
    } else {
      it.x = bounds.x + r() * bounds.w; it.y = bounds.y + r() * bounds.h; it.state = 'out';
    }
    const a = home ? (r() - 0.5) * 1.2 + (home.x < bounds.x + bounds.w / 2 ? 0 : Math.PI) : r() * TAU;
    it.angle = a; it.vx = Math.cos(a) * speed; it.vy = Math.sin(a) * speed;
    it.speed = speed * (0.9 + r() * 0.2);
    items.push(it);
  }
  const api = { items, time: 0, update, bounds, home };

  function update(dt) {
    api.time += dt;
    const n = items.length;
    for (let i = 0; i < n; i++) {
      const b = items[i];
      b.t += dt;
      if (b.state === 'inside') {
        b.timer -= dt;
        if (b.timer <= 0) {
          b.state = 'out'; b.alpha = 1; b.x = home.x; b.y = home.y; b.timer = b.tour;
          const a = b.angle; b.vx = Math.cos(a) * b.speed; b.vy = Math.sin(a) * b.speed;
        }
        continue;
      }
      let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, cnt = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = items[j];
        if (o.state === 'inside') continue;
        const dx = o.x - b.x, dy = o.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > nbR * nbR || d2 === 0) continue;
        cnt++;
        cx += o.x; cy += o.y; ax += o.vx; ay += o.vy;
        if (d2 < sepR * sepR) { const d = Math.sqrt(d2); sx -= dx / d * (sepR - d) / sepR; sy -= dy / d * (sepR - d) / sepR; }
      }
      let fx = 0, fy = 0;
      if (cnt) {
        cx /= cnt; cy /= cnt; ax /= cnt; ay /= cnt;
        fx += (cx - b.x) * 0.9 + (ax - b.vx) * 0.6 + sx * speed * 2.2;
        fy += (cy - b.y) * 0.9 + (ay - b.vy) * 0.6 + sy * speed * 2.2;
      }
      // soft bounds
      const m = diag * 0.08;
      if (b.x < bounds.x + m) fx += (bounds.x + m - b.x) * 3;
      if (b.x > bounds.x + bounds.w - m) fx -= (b.x - (bounds.x + bounds.w - m)) * 3;
      if (b.y < bounds.y + m) fy += (bounds.y + m - b.y) * 3;
      if (b.y > bounds.y + bounds.h - m) fy -= (b.y - (bounds.y + bounds.h - m)) * 3;
      // wandering turn so lone birds still curve
      const wob = Math.sin(b.t * 0.7 + b.phase) * 0.8;
      fx += -b.vy * wob * 0.5; fy += b.vx * wob * 0.5;
      if (home) {
        b.timer -= dt;
        if (b.state === 'out' && b.timer <= 0) b.state = 'returning';
        if (b.state === 'returning') {
          const dx = home.x - b.x, dy = home.y - b.y;
          const d = Math.hypot(dx, dy) || 1;
          fx += dx / d * speed * 3; fy += dy / d * speed * 3;
          if (d < diag * 0.03) {
            b.state = 'inside'; b.alpha = 0; b.timer = rest + r() * rest;
            b.angle = (r() - 0.5) * 1.2 + (home.x < bounds.x + bounds.w / 2 ? 0 : Math.PI);
            continue;
          }
          if (d < diag * 0.08) b.alpha = d / (diag * 0.08);
        } else if (b.state === 'out' && b.alpha < 1) b.alpha = Math.min(1, b.alpha + dt * 2);
      }
      b.vx += fx * dt; b.vy += fy * dt;
      // normalise toward cruise speed
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const want = b.speed * (b.state === 'returning' ? 1.15 : 1);
      const k = 1 + (want / sp - 1) * Math.min(1, dt * 4);
      b.vx *= k; b.vy *= k;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.angle = Math.atan2(b.vy, b.vx);
    }
  }
  return api;
}

// ---------------------------------------------------------------------------
// swimPath: gliding inside / along a closed polygon
// ---------------------------------------------------------------------------

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyBounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function polyCentroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return { x: x / poly.length, y: y / poly.length };
}
function randomInPolygon(r, poly, bb, inset) {
  for (let k = 0; k < 40; k++) {
    const x = bb.x + r() * bb.w, y = bb.y + r() * bb.h;
    if (pointInPolygon(x, y, poly) && (inset <= 0 || distToEdge(x, y, poly) > inset)) return { x, y };
  }
  return polyCentroid(poly);
}
function distToEdge(x, y, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const u = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
    best = Math.min(best, Math.hypot(ax + dx * u - x, ay + dy * u - y));
  }
  return best;
}

/**
 * swimPath({ polygon: [[x,y],...], speed, seed, count?, inset?, turnRate?, pause? })
 * Items glide between random targets inside the polygon, easing their heading, and
 * idle (paddling in place) for a while when they arrive. `inset` keeps them off the
 * shoreline. Items carry `heading` (smoothed) and `paused` (0/1).
 */
export function swimPath(opts) {
  const { polygon, speed = 20, seed = 1, count = 3, inset = null, turnRate = 1.2, pause = 3 } = opts;
  const r = rng(seed);
  const bb = polyBounds(polygon);
  const ins = inset != null ? inset : Math.min(bb.w, bb.h) * 0.12;
  const items = [];
  for (let i = 0; i < count; i++) {
    const it = makeItem(r, 'swimmer', {});
    const p = randomInPolygon(r, polygon, bb, ins);
    it.x = p.x; it.y = p.y;
    it.target = randomInPolygon(r, polygon, bb, ins);
    it.angle = Math.atan2(it.target.y - it.y, it.target.x - it.x);
    it.speed = speed * (0.8 + r() * 0.4);
    it.paused = 0; it.wait = r() * pause; it.v = 0;
    items.push(it);
  }
  const api = { items, time: 0, update, polygon };
  function update(dt) {
    api.time += dt;
    for (const s of items) {
      s.t += dt;
      const dx = s.target.x - s.x, dy = s.target.y - s.y;
      const d = Math.hypot(dx, dy);
      if (s.wait > 0) {
        s.wait -= dt; s.paused = 1;
        s.v = Math.max(0, s.v - s.speed * dt * 0.8);
        s.angle += Math.sin(s.t * 0.5 + s.phase) * dt * 0.08;
      } else {
        s.paused = 0;
        const want = Math.atan2(dy, dx);
        s.angle = turnToward(s.angle, want, turnRate * dt);
        const slow = Math.min(1, d / (ins * 1.5 + 1e-6));
        s.v += (s.speed * (0.4 + 0.6 * slow) - s.v) * Math.min(1, dt * 1.5);
        if (d < Math.max(2, s.speed * 0.15)) {
          s.target = randomInPolygon(r, polygon, bb, ins);
          s.wait = pause * (0.4 + r() * 1.2);
        }
      }
      let nx = s.x + Math.cos(s.angle) * s.v * dt, ny = s.y + Math.sin(s.angle) * s.v * dt;
      if (!pointInPolygon(nx, ny, polygon)) {
        // bounce back toward the centre of the pond
        const c = polyCentroid(polygon);
        s.angle = turnToward(s.angle, Math.atan2(c.y - s.y, c.x - s.x), 0.8);
        nx = s.x; ny = s.y;
        s.target = randomInPolygon(r, polygon, bb, ins);
      }
      s.x = nx; s.y = ny;
    }
  }
  return api;
}

// ---------------------------------------------------------------------------
// wander: insects drifting around a centre
// ---------------------------------------------------------------------------

/**
 * wander({ center: {x,y}, radius, speed, count?, seed, jitter?, flutter?, settle? })
 * Smoothly turning random walk held inside `radius`. `jitter` sets how twitchy the
 * heading is (butterflies high, dragonflies low with darts). `flutter` adds a vertical
 * bob. With `settle` > 0, items occasionally land (v = 0, item.rest = 1) for that many
 * seconds, so a butterfly can close its wings on a flower.
 */
export function wander(opts) {
  const { center, radius, speed = 20, count = 1, seed = 1, jitter = 2.5, flutter = 0.3, settle = 0, dart = 0 } = opts;
  const r = rng(seed);
  const items = [];
  for (let i = 0; i < count; i++) {
    const it = makeItem(r, 'insect', {});
    const a = r() * TAU, d = Math.sqrt(r()) * radius;
    it.x = center.x + Math.cos(a) * d; it.y = center.y + Math.sin(a) * d;
    it.angle = r() * TAU; it.heading = it.angle; it.v = speed; it.rest = 0; it.restT = 0;
    it.until = r() * 6; it.turn = 0;
    items.push(it);
  }
  const api = { items, time: 0, update, center, radius };
  function update(dt) {
    api.time += dt;
    for (const it of items) {
      it.t += dt;
      if (it.rest > 0) {
        it.restT -= dt;
        if (it.restT <= 0) { it.rest = 0; it.v = speed * 0.5; }
        continue;
      }
      // smoothly varying turn rate
      it.turn += (r() - 0.5) * jitter * dt * 6;
      it.turn *= Math.max(0, 1 - dt * 2.5);
      it.heading += it.turn * dt;
      // stay inside the radius
      const dx = it.x - center.x, dy = it.y - center.y;
      const d = Math.hypot(dx, dy);
      if (d > radius * 0.75) {
        const back = Math.atan2(-dy, -dx);
        const k = (d - radius * 0.75) / (radius * 0.25);
        it.heading = turnToward(it.heading, back, clamp(k, 0, 1) * 4 * dt);
      }
      // darts (dragonflies): short bursts of speed in a straight line
      if (dart > 0) {
        it.until -= dt;
        if (it.until <= 0) { it.v = it.v > speed * 1.5 ? speed * 0.4 : speed * 3; it.until = it.v > speed ? 0.25 + r() * 0.4 : 0.8 + r() * 2; }
        it.v += (speed * 0.6 - it.v) * Math.min(1, dt * 0.8);
      } else {
        it.v += (speed * (0.6 + 0.4 * Math.sin(it.t * 1.3 + it.phase)) - it.v) * Math.min(1, dt * 3);
      }
      if (settle > 0) {
        it.until -= dt;
        if (it.until <= 0 && r() < dt * 0.15) { it.rest = 1; it.restT = settle * (0.5 + r()); it.v = 0; it.until = 4 + r() * 6; }
      }
      const bobY = flutter * Math.sin(it.t * 7 + it.phase) * speed * 0.3;
      it.x += Math.cos(it.heading) * it.v * dt;
      it.y += Math.sin(it.heading) * it.v * dt + bobY * dt;
      it.angle = turnToward(it.angle, it.heading, 6 * dt);
    }
  }
  return api;
}

// ---------------------------------------------------------------------------
// particles: embers, smoke, droplets, bubbles, ash
// ---------------------------------------------------------------------------

/**
 * particles({ emitter: {x, y, w?, h?}, rate, life, velocity: {x, y}, gravity?, spread?,
 *             seed, max?, drag?, wobble?, grow?, kind?, scaleRange?, fade? })
 * - rate: particles per second (fractional ok). life: seconds (randomised ±30%).
 * - velocity: initial velocity; spread: random angle (radians) applied to it and
 *   a ±spread*50% speed variation. gravity: {x, y} or a number for y.
 * - drag: per-second velocity damping. wobble: sideways sway amplitude.
 * - grow: scale multiplier reached at end of life (smoke ~3, embers ~0.3).
 * - Items carry age, life, u = age/life, and `alpha` fades in/out with `fade` seconds.
 * - Items stay in the array while alive; dead ones are recycled. Set `prewarm`
 *   seconds to simulate ahead so the emitter does not start empty.
 */
export function particles(opts) {
  const {
    emitter, rate = 10, life = 3, velocity = { x: 0, y: -20 }, gravity = 0, spread = 0.3,
    seed = 1, max = null, drag = 0, wobble = 0, grow = 1, kind = 'particle', scaleRange = [0.7, 1.3],
    fade = 0.3, prewarm = 0, angleFromVelocity = true, spin = 0,
  } = opts;
  const r = rng(seed);
  const g = typeof gravity === 'number' ? { x: 0, y: gravity } : gravity;
  const cap = max || Math.ceil(rate * life * 1.4) + 2;
  const items = [];
  const api = { items, time: 0, update, emit, emitter };
  let acc = 0;
  const pool = [];
  const sp0 = Math.hypot(velocity.x, velocity.y);
  const a0 = Math.atan2(velocity.y, velocity.x);

  function emit(n = 1) {
    for (let i = 0; i < n; i++) {
      if (items.length >= cap && pool.length === 0) return;
      const p = pool.pop() || makeItem(r, kind, {});
      const ew = emitter.w || 0, eh = emitter.h || 0;
      p.x = emitter.x + (r() - 0.5) * ew; p.y = emitter.y + (r() - 0.5) * eh;
      const a = a0 + (r() - 0.5) * 2 * spread;
      const s = sp0 * (1 + (r() - 0.5) * spread);
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.age = 0; p.life = life * (0.7 + r() * 0.6); p.u = 0;
      p.t = 0; p.phase = r() * TAU; p.alpha = 0;
      p.baseScale = scaleRange[0] + r() * (scaleRange[1] - scaleRange[0]);
      p.scale = p.baseScale; p.kind = kind;
      p.angle = angleFromVelocity ? a : r() * TAU;
      p.spin = (r() - 0.5) * 2 * spin;
      if (items.indexOf(p) < 0) items.push(p);
    }
  }
  function update(dt) {
    api.time += dt;
    acc += rate * dt;
    while (acc >= 1) { acc -= 1; emit(1); }
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.age += dt; p.t = p.age;
      if (p.age >= p.life) { items.splice(i, 1); pool.push(p); continue; }
      p.u = p.age / p.life;
      p.vx += g.x * dt; p.vy += g.y * dt;
      if (drag) { const k = Math.max(0, 1 - drag * dt); p.vx *= k; p.vy *= k; }
      const sway = wobble ? Math.sin(p.age * 2.3 + p.phase) * wobble : 0;
      p.x += (p.vx - p.vy * sway * 0.02) * dt; p.y += (p.vy + p.vx * sway * 0.02) * dt;
      if (wobble) { p.x += Math.cos(p.age * 1.7 + p.phase) * wobble * dt; }
      p.scale = p.baseScale * (1 + (grow - 1) * p.u);
      const fin = fade > 0 ? Math.min(1, p.age / fade) : 1;
      const fout = fade > 0 ? Math.min(1, (p.life - p.age) / (fade * 2)) : 1;
      p.alpha = Math.min(fin, fout);
      if (angleFromVelocity) p.angle = Math.atan2(p.vy, p.vx); else p.angle += p.spin * dt;
    }
  }
  if (prewarm > 0) { const steps = Math.ceil(prewarm / 0.05); for (let i = 0; i < steps; i++) update(prewarm / steps); }
  return api;
}

// ---------------------------------------------------------------------------
// leap: fish jumping out of the water and back
// ---------------------------------------------------------------------------

/**
 * leap({ from: {x,y}, to: {x,y}, height, period, seed, count?, duration?, splash? })
 * Each item waits submerged (alpha 0) and then follows a parabola from `from` to `to`
 * (both at the water line) peaking `height` above it, taking `duration` seconds, once
 * per `period`. Items carry `airborne` (0/1), `u` (0..1 along the arc) and `bend`
 * (-1..1, body curvature for the fish sprite). Angle follows the tangent, so the fish
 * noses up on the way out and dives nose-first on the way in. `splash` is a callback
 * (item, phase: 'exit'|'entry') for the caller to spawn droplets.
 */
export function leap(opts) {
  const { from, to, height, period = 6, seed = 1, count = 1, duration = 1.1, splash = null, mirror = false } = opts;
  const r = rng(seed);
  const items = [];
  for (let i = 0; i < count; i++) {
    const it = makeItem(r, 'fish', {});
    it.x = from.x; it.y = from.y; it.alpha = 0; it.airborne = 0; it.u = 0; it.bend = 0;
    it.timer = r() * period; it.dir = mirror && r() < 0.5 ? -1 : 1; it.scale = 0.85 + r() * 0.3;
    items.push(it);
  }
  const api = { items, time: 0, update, from, to };
  function update(dt) {
    api.time += dt;
    for (const f of items) {
      f.t += dt;
      if (!f.airborne) {
        f.timer -= dt;
        if (f.timer <= 0) {
          f.airborne = 1; f.u = 0; f.alpha = 1; f.dir = mirror && r() < 0.5 ? -1 : 1;
          if (splash) splash(f, 'exit');
        } else continue;
      }
      f.u += dt / duration;
      if (f.u >= 1) {
        f.airborne = 0; f.alpha = 0; f.u = 0; f.timer = period * (0.7 + r() * 0.6);
        if (splash) splash(f, 'entry');
        continue;
      }
      const u = f.u;
      const A = f.dir > 0 ? from : to, B = f.dir > 0 ? to : from;
      const x = A.x + (B.x - A.x) * u;
      const y = A.y + (B.y - A.y) * u - 4 * height * u * (1 - u);
      const dx = (B.x - A.x), dy = (B.y - A.y) - 4 * height * (1 - 2 * u);
      f.x = x; f.y = y;
      f.angle = Math.atan2(dy, dx);
      f.bend = Math.sin(u * Math.PI) * 0.6 * (f.dir > 0 ? 1 : -1);
      f.flipY = f.dir < 0; // keep the belly down when leaping leftward
      f.alpha = Math.min(1, u * 8, (1 - u) * 8);
    }
  }
  return api;
}

// ---------------------------------------------------------------------------
// perch: a bird sitting at a point, giving its own time and occasional pose changes
// ---------------------------------------------------------------------------

/**
 * perch({ points: [{x,y,angle?}], seed }) Items sit still; `t` advances so the sprite
 * can breathe, look around and flick its tail. Cheap helper so perched birds use the
 * same items contract as the moving behaviours.
 */
export function perch(opts) {
  const { points, seed = 1 } = opts;
  const r = rng(seed);
  const items = points.map((p) => makeItem(r, 'perched', { x: p.x, y: p.y, angle: p.angle || 0, scale: p.scale || 1 }));
  const api = { items, time: 0, update };
  function update(dt) { api.time += dt; for (const it of items) it.t += dt; }
  return api;
}
