// Brings figures to life from rig data (src/living/rigs.js): displacement rigs (rotate,
// translate, scale) are evaluated here and handed to the post shader; overlay rigs (eyes,
// splash, glow) are drawn on the living layer's Canvas2D.
import { WORLD_W as W, WORLD_H as H } from '../world.ts';

const TAU = Math.PI * 2;
const KIND = { rotate: 1, translate: 2, scale: 3 };

function wave(kind, t, period, phase) {
  const u = t / period + phase / TAU;
  switch (kind) {
    case 'gallop': return Math.abs(Math.sin(Math.PI * u)) * 2 - 1;
    case 'saw': { const f = u - Math.floor(u); return f < 0.8 ? (f / 0.8) * 2 - 1 : 1 - ((f - 0.8) / 0.2) * 2; }
    case 'pulse': { const f = u - Math.floor(u); return f < 0.08 ? Math.sin((f / 0.08) * Math.PI) : 0; }
    default: return Math.sin(TAU * u);
  }
}
const hexRgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export class Animator {
  constructor(rigs) {
    this.enabled = true;
    this.warps = [];
    this.overlays = [];
    for (const r of rigs) {
      if (KIND[r.kind]) {
        const reg = r.region;
        const angle = ((reg.angle || 0) * Math.PI) / 180;
        this.warps.push({
          id: r.id, kind: r.kind, cx: reg.x * W, cy: reg.y * H, rx: reg.rx * W, ry: reg.ry * H, angle,
          feather: r.feather ?? 0.4, px: (r.pivot?.x ?? reg.x) * W, py: (r.pivot?.y ?? reg.y) * H,
          amount: r.amount, period: r.period || 6, phase: r.phase || 0, wave: r.wave || 'sine',
          near: r.trigger === 'near', env: r.trigger === 'near' ? 0 : 1,
          reach: Math.max(reg.rx * W, reg.ry * H),
        });
      } else {
        this.overlays.push({ ...r, state: {} });
      }
    }
  }

  // Pick and evaluate the warps that matter for this view; returns the list for Post.setRigs.
  frame(camera, time, dt, pointer) {
    const v = camera.view();
    const out = [];
    const cand = [];
    for (const r of this.warps) {
      r.cur = null;
      const m = r.reach * 1.2;
      if (r.cx + m < v.x0 || r.cx - m > v.x1 || r.cy + m < v.y0 || r.cy - m > v.y1) continue;
      if (r.reach * camera.scale < 6) continue; // too small on screen to read as motion
      if (r.near) {
        const inside = pointer && Math.hypot((pointer[0] - r.cx) / r.rx, (pointer[1] - r.cy) / r.ry) < 1.3;
        r.env += ((inside ? 1 : 0) - r.env) * (1 - Math.exp(-dt * (inside ? 1.6 : 0.7)));
        if (r.env < 0.01) continue;
      }
      cand.push(r);
    }
    // nearest the view centre first
    cand.sort((a, b) => Math.hypot(a.cx - camera.cx, a.cy - camera.cy) - Math.hypot(b.cx - camera.cx, b.cy - camera.cy));
    for (const r of cand.slice(0, 16)) {
      const w = wave(r.wave, time, r.period, r.phase) * r.env * (this.enabled ? 1 : 0);
      let a = 0, b = 0;
      if (r.kind === 'rotate') a = (r.amount * Math.PI / 180) * w;
      else if (r.kind === 'translate') { a = (r.amount.dx || 0) * W * w; b = (r.amount.dy || 0) * H * w; }
      else a = r.amount * w; // breathing: swells and eases back
      r.cur = { a, b };
      out.push({ cx: r.cx, cy: r.cy, rx: r.rx, ry: r.ry, angle: r.angle, feather: r.feather, kind: KIND[r.kind], px: r.px, py: r.py, a, b });
    }
    // eyes: Bosch's own painted iris slides inside each eye opening toward the pointer
    // (a small translate warp per eye, so the brushwork stays his); they take precedence
    const eyes = this.enabled ? this.eyeWarps(camera, time, dt, pointer) : [];
    return [...eyes, ...out].slice(0, 16);
  }

  eyeWarps(camera, time, dt, pointer) {
    const v = camera.view();
    const list = [];
    for (const r of this.overlays) {
      if (r.kind !== 'eyes') continue;
      const st = r.state;
      const eyes = r.eyes.map((e) => {
        const [x, y] = r.attach ? this.carry(r.attach, e.x * W, e.y * H) : [e.x * W, e.y * H];
        return { x, y, r: e.r * W };
      });
      const cx = eyes.reduce((a, e) => a + e.x, 0) / eyes.length, cy = eyes.reduce((a, e) => a + e.y, 0) / eyes.length;
      const m = eyes[0].r * 30;
      st.visible = !(cx + m < v.x0 || cx - m > v.x1 || cy + m < v.y0 || cy - m > v.y1) && eyes[0].r * camera.scale >= 1.5;
      if (!st.visible) continue;
      // where to look: the pointer when it is near, otherwise a slow idle glance
      let tx = Math.sin(time * 0.31 + cx) * 0.4, ty = Math.sin(time * 0.23 + cy) * 0.25;
      if (r.follow === 'pointer' && pointer) {
        const dx = pointer[0] - cx, dy = pointer[1] - cy, d = Math.hypot(dx, dy);
        const reach = eyes[0].r * 80;
        if (d < reach) {
          const k = Math.min(1, 1.6 * (1 - d / reach));
          const near = Math.min(1, d / (eyes[0].r * 6)); // right on top of the eye: look straight out
          tx = tx * (1 - k) + (dx / (d || 1)) * near * k;
          ty = ty * (1 - k) + (dy / (d || 1)) * near * k;
        }
      }
      const ease = 1 - Math.exp(-dt * 5);
      st.lx = (st.lx ?? tx) + (tx - (st.lx ?? tx)) * ease;
      st.ly = (st.ly ?? ty) + (ty - (st.ly ?? ty)) * ease;
      st.eyes = eyes;
      for (const e of eyes) {
        list.push({
          cx: e.x, cy: e.y, rx: e.r * 1.25, ry: e.r * 1.0, angle: 0, feather: 0.75, kind: KIND.translate, px: e.x, py: e.y,
          a: st.lx * e.r * 0.38, b: st.ly * e.r * 0.26,
        });
      }
    }
    return list;
  }

  // Where the shader's warp carries the painted point (x, y) right now: eyes attached to a
  // moving head ride along with it instead of drifting off the face.
  carry(id, x, y) {
    const r = this.warps.find((w) => w.id === id);
    if (!r || !r.cur) return [x, y];
    const dx = x - r.cx, dy = y - r.cy, ca = Math.cos(r.angle), sa = Math.sin(r.angle);
    const lx = (dx * ca + dy * sa) / r.rx, ly = (-dx * sa + dy * ca) / r.ry;
    const d = Math.hypot(lx, ly);
    if (d >= 1) return [x, y];
    const e0 = 1 - r.feather, u = Math.max(0, Math.min(1, (d - e0) / (1 - e0)));
    const wt = 1 - u * u * (3 - 2 * u);
    if (r.kind === 'rotate') {
      const a = r.cur.a * wt, qx = x - r.px, qy = y - r.py;
      return [r.px + qx * Math.cos(a) - qy * Math.sin(a), r.py + qx * Math.sin(a) + qy * Math.cos(a)];
    }
    if (r.kind === 'translate') return [x + r.cur.a * wt, y + r.cur.b * wt];
    return [r.px + (x - r.px) * (1 + r.cur.a * wt), r.py + (y - r.py) * (1 + r.cur.a * wt)];
  }

  // Overlay rigs, drawn in world coordinates (the caller has set the camera transform).
  draw(ctx, camera, time, dt, pointer, inView, splash) {
    if (!this.enabled) return;
    const s = camera.scale;
    for (const r of this.overlays) {
      if (r.kind === 'eyes') this.drawEyes(ctx, r, s, time, dt);
      else if (r.kind === 'glow') this.drawGlow(ctx, r, s, time, inView);
      else if (r.kind === 'splash') this.drawSplash(ctx, r, s, dt, inView, splash);
    }
  }

  // The eyes themselves move in the shader (eyeWarps); here only what paint cannot do:
  // a soft glow for eyes in the dark, and the lids closing for a blink.
  drawEyes(ctx, r, s, time, dt) {
    const st = r.state;
    if (!st.visible || !st.eyes) return;
    st.next = (st.next ?? 1 + Math.random() * 3) - dt;
    if (r.blink && st.next <= 0 && st.blink == null) { st.blink = 0; const [a, b] = r.blink; st.next = a + Math.random() * (b - a); }
    let lid = 0;
    if (st.blink != null) { st.blink += dt; const u = st.blink / 0.22; lid = Math.sin(Math.min(1, u) * Math.PI); if (u >= 1) st.blink = null; }
    for (const e of st.eyes) {
      ctx.save();
      if (r.glow) {
        const [gr, gg, gb] = hexRgb(r.sclera || '#c8c070');
        ctx.globalCompositeOperation = 'lighter';
        const a = (0.1 + 0.06 * Math.sin(time * 1.7 + e.x)) * (1 - lid);
        const g = ctx.createRadialGradient(e.x, e.y, e.r * 0.4, e.x, e.y, e.r * 1.9);
        g.addColorStop(0, `rgba(${gr},${gg},${gb},${a})`); g.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.9, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      if (lid > 0.02) {
        // the lid slides down over the eye opening, clipped to it, with a soft lower edge
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * 1.12, e.r * 1.02, 0, 0, TAU); ctx.clip();
        const top = e.y - e.r * 1.05, edge = top + e.r * 2.1 * lid;
        const [lr, lg, lb] = hexRgb(r.lid || '#8a7462');
        const g = ctx.createLinearGradient(0, top, 0, edge);
        g.addColorStop(0, `rgba(${lr},${lg},${lb},1)`); g.addColorStop(0.8, `rgba(${lr},${lg},${lb},1)`); g.addColorStop(1, `rgba(${lr},${lg},${lb},0.4)`);
        ctx.fillStyle = g; ctx.fillRect(e.x - e.r * 1.2, top, e.r * 2.4, edge - top);
      }
      ctx.restore();
    }
  }

  drawGlow(ctx, r, s, time, inView) {
    const x = r.x * W, y = r.y * H, rad = r.r * W;
    if (!inView(x, y, rad * 3) || rad * s < 1) return;
    const [cr, cg, cb] = hexRgb(r.color || '#ffb060');
    const f = 1 - (r.flicker ?? 0.4) * (0.5 + 0.5 * Math.sin(time * 9 + x) * Math.sin(time * 5.3 + y));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.45 * f})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawSplash(ctx, r, s, dt, inView, splash) {
    const st = r.state;
    st.drops = st.drops || [];
    st.next = (st.next ?? Math.random() * 2) - dt;
    const size = (r.size || 0.0008) * W;
    if (st.next <= 0) {
      const [a, b] = r.every || [1, 3];
      st.next = a + Math.random() * (b - a);
      const p = r.points[Math.floor(Math.random() * r.points.length)];
      const x = p.x * W, y = p.y * H;
      if (inView(x, y, size * 10)) {
        splash?.(x, y, size * 0.9);
        for (let i = 0; i < 9; i++) {
          const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
          const sp = size * (2.2 + Math.random() * 2.5);
          st.drops.push({ x, y, y0: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t: 0 });
        }
      }
    }
    if (!st.drops.length) return;
    const g = size * 9;
    ctx.save();
    ctx.fillStyle = 'rgba(232,240,246,0.85)';
    for (const d of st.drops) {
      d.t += dt; d.vy += g * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.y > d.y0 && d.vy > 0) { d.dead = true; continue; }
      const rad = Math.max(size * 0.09, 0.7 / s);
      ctx.beginPath(); ctx.ellipse(d.x, d.y, rad, rad * 1.4, Math.atan2(d.vy, d.vx) + Math.PI / 2, 0, TAU); ctx.fill();
    }
    st.drops = st.drops.filter((d) => !d.dead);
    ctx.restore();
  }
}
