// Tile atlas: paints 256 px tiles of any level from stroke files, progressively,
// and provides draw rects (with ancestor fallback) for the compositor.
import { createProgram, createTexture, createFramebuffer } from './gl.js';
import { STROKE_VS, STROKE_FS, FILL_VS, FILL_FS } from './shaders.js';
import { RECORD_BYTES } from '../shared/strokeModel.js';
import { TILE, GROUND, levelTiles, WORLD_W, WORLD_H, MAX_Z } from '../world.js';

export const BORDER = 4;
const SLOT = TILE + 2 * BORDER;
const REACH = 40; // max stroke extent past its file tile, native px
const PAINT_MS = 520;
const FRAME_INSTANCE_BUDGET = 600_000; // keeps GPU work per frame well under 16 ms while panning

export class TileCache {
  constructor(gl, quad, store) {
    this.gl = gl;
    this.quad = quad;
    this.store = store;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    // phones and tablets share memory with the GPU: a 64 MB atlas instead of 256 MB
    const small = window.matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory ?? 8) < 8;
    this.size = Math.min(small ? 4096 : 8192, max);
    this.cols = Math.floor(this.size / SLOT);
    this.slots = this.cols * this.cols;
    this.free = Array.from({ length: this.slots }, (_, i) => this.slots - 1 - i);
    this.atlas = createTexture(gl, this.size, this.size);
    this.fbo = createFramebuffer(gl, this.atlas);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.clearColor(GROUND[0] / 255, GROUND[1] / 255, GROUND[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stroke = createProgram(gl, STROKE_VS, STROKE_FS, 'stroke');
    this.fill = createProgram(gl, FILL_VS, FILL_FS, 'fill');
    this.fillVao = gl.createVertexArray();
    gl.bindVertexArray(this.fillVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.tiles = new Map();
    this.frame = 0;
    this.instant = false;
    this.stats = { painting: 0, done: 0, instances: 0 };
    this.totalStrokes = 0; // every stroke laid this session, shown in the strokes panel
    this.strokeView = 0;
  }

  key(z, x, y) { return `${z}/${x}/${y}`; }

  // Ensure a tile exists and is being prepared. Returns the tile.
  request(z, x, y, priority = 0, pinned = false) {
    const k = this.key(z, x, y);
    let t = this.tiles.get(k);
    if (!t) {
      if (!this.free.length && !this.evict()) return null;
      t = { k, z, x, y, slot: this.free.pop(), state: 'wait', files: null, lastUsed: this.frame, pinned, priority };
      this.tiles.set(k, t);
      t.files = this.neededFiles(z, x, y, priority);
    }
    t.lastUsed = this.frame;
    t.priority = priority;
    if (pinned) t.pinned = true;
    if (t.state === 'wait') for (const f of t.files) this.store.get(f.z, f.x, f.y, priority + (z - f.z) * -0.5);
    return t;
  }

  neededFiles(z, x, y, priority) {
    const files = [];
    const rx0 = x * TILE - BORDER, ry0 = y * TILE - BORDER;
    const top = Math.min(z, this.store.maxZ);
    for (let za = 0; za <= top; za++) {
      const scale = Math.pow(2, z - za);
      const { nx, ny } = levelTiles(za);
      let fx0, fx1, fy0, fy1;
      if (za === 0) { fx0 = 0; fx1 = nx - 1; fy0 = 0; fy1 = ny - 1; }
      else {
        fx0 = Math.max(0, Math.floor((rx0 / scale - REACH) / TILE));
        fx1 = Math.min(nx - 1, Math.floor(((rx0 + SLOT) / scale + REACH) / TILE));
        fy0 = Math.max(0, Math.floor((ry0 / scale - REACH) / TILE));
        fy1 = Math.min(ny - 1, Math.floor(((ry0 + SLOT) / scale + REACH) / TILE));
      }
      for (let fy = fy0; fy <= fy1; fy++) for (let fx = fx0; fx <= fx1; fx++) {
        if (!this.store.exists(za, fx, fy)) continue;
        files.push({
          z: za, x: fx, y: fy, scale,
          ox: fx * TILE * scale - rx0, oy: fy * TILE * scale - ry0,
          entry: this.store.get(za, fx, fy, priority),
        });
      }
    }
    return files;
  }

  evict() {
    let victim = null;
    for (const t of this.tiles.values()) {
      if (t.pinned || t.lastUsed >= this.frame - 1) continue;
      if (!victim || t.lastUsed < victim.lastUsed) victim = t;
    }
    if (!victim) return false;
    this.tiles.delete(victim.k);
    this.free.push(victim.slot);
    return true;
  }

  // Bind a file's VAO with its instance attributes starting at `start`.
  bindFile(e, start) {
    const gl = this.gl;
    gl.bindVertexArray(e.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, e.vbo);
    const off = start * RECORD_BYTES;
    gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, false, RECORD_BYTES, off);
    gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, RECORD_BYTES, off + 4);
    gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, RECORD_BYTES, off + 8);
  }

  drawFile(f, start, end) {
    const e = f.entry;
    if (e.state !== 'ready' || !e.vao || end <= start) return 0;
    const gl = this.gl;
    gl.uniform1f(this.stroke.u.u_scale, f.scale);
    gl.uniform2f(this.stroke.u.u_offset, f.ox, f.oy);
    this.bindFile(e, start);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - start);
    this.totalStrokes += end - start;
    return end - start;
  }

  bindSlot(t) {
    const gl = this.gl;
    const sx = (t.slot % this.cols) * SLOT, sy = Math.floor(t.slot / this.cols) * SLOT;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(sx, sy, SLOT, SLOT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(sx, sy, SLOT, SLOT);
  }

  // Advance painting for queued tiles, nearest first, within a per-frame budget.
  paint(now) {
    const gl = this.gl;
    this.frame++;
    let budget = FRAME_INSTANCE_BUDGET;
    const active = [...this.tiles.values()].filter((t) => t.state !== 'done' && t.lastUsed >= this.frame - 2);
    active.sort((a, b) => a.priority - b.priority);
    let painting = 0;
    gl.disable(gl.DEPTH_TEST);
    for (const t of active) {
      if (budget <= 0) break;
      if (t.state === 'wait') {
        if (t.files.some((f) => f.entry.state === 'queued' || f.entry.state === 'loading' || f.entry.state === 'idle')) continue;
        // all resolved: ground + ancestors now, finest level animated
        const present = t.files.filter((f) => f.entry.state === 'ready' && f.entry.count > 0);
        t.animZ = present.length ? Math.max(...present.map((f) => f.z)) : 0;
        t.anim = present.filter((f) => f.z === t.animZ).map((f) => ({ f, drawn: 0 }));
        t.total = t.anim.reduce((a, s) => a + s.f.entry.count, 0);
        this.bindSlot(t);
        gl.useProgram(this.fill.program);
        gl.uniform3f(this.fill.u.u_color, GROUND[0] / 255, GROUND[1] / 255, GROUND[2] / 255);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(this.fillVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.useProgram(this.stroke.program);
        gl.uniform2f(this.stroke.u.u_dstSize, SLOT, SLOT);
        gl.uniform1f(this.stroke.u.u_fade, 1);
        gl.uniform1f(this.stroke.u.u_strokeView, this.strokeView);
        for (const f of present) if (f.z < t.animZ) budget -= this.drawFile(f, 0, f.entry.count);
        t.state = 'paint';
        t.start = now;
        // the first frame of a tile that nobody saw yet can go instantly
        t.instant = this.instant || t.z <= 1;
      }
      if (t.state === 'paint' && t.anim.some((a) => a.f.entry.state !== 'ready')) {
        // a file was evicted mid-paint: start this tile over once its files are back
        t.state = 'wait';
        continue;
      }
      if (t.state === 'paint') {
        for (const a of t.anim) a.f.entry.lastUsed = this.store.frame;
        this.bindSlot(t);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.useProgram(this.stroke.program);
        gl.uniform2f(this.stroke.u.u_dstSize, SLOT, SLOT);
        gl.uniform1f(this.stroke.u.u_fade, 1);
        gl.uniform1f(this.stroke.u.u_strokeView, this.strokeView);
        const p = t.instant ? 1 : Math.min(1, (now - t.start) / PAINT_MS);
        const e = 1 - Math.pow(1 - p, 2);
        let left = 0;
        for (const a of t.anim) {
          const target = p >= 1 ? a.f.entry.count : Math.ceil(a.f.entry.count * e);
          const n = this.drawFile(a.f, a.drawn, target);
          a.drawn = target;
          budget -= n;
          left += a.f.entry.count - a.drawn;
        }
        painting++;
        if (p >= 1 && left === 0) t.state = 'done';
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stats.painting = painting;
    this.stats.instances = FRAME_INSTANCE_BUDGET - budget;
  }

  // Switch between the painting and the stroke view: every tile is painted again, stroke by stroke.
  setStrokeView(on) {
    this.strokeView = on ? 1 : 0;
    for (const t of this.tiles.values()) { t.state = 'wait'; t.instant = false; }
  }

  // UV rect of a tile's inner 256 px (or a sub-rect of it, in tile px).
  uvRect(t, sx0 = 0, sy0 = 0, sx1 = TILE, sy1 = TILE) {
    const bx = (t.slot % this.cols) * SLOT + BORDER, by = Math.floor(t.slot / this.cols) * SLOT + BORDER;
    return [(bx + sx0) / this.size, (by + sy0) / this.size, (bx + sx1) / this.size, (by + sy1) / this.size];
  }

  // Find what to draw for tile (z,x,y): itself if painted, else the nearest painted ancestor's sub-rect.
  source(z, x, y) {
    let zz = z, xx = x, yy = y;
    let fx0 = 0, fy0 = 0, fsz = TILE; // sub-rect in the candidate tile, tile px
    while (zz >= 0) {
      const t = this.tiles.get(this.key(zz, xx, yy));
      if (t && t.state !== 'wait') { t.lastUsed = this.frame; return { t, uv: this.uvRect(t, fx0, fy0, fx0 + fsz, fy0 + fsz) }; }
      // go to parent
      fx0 = (fx0 + (xx & 1) * TILE) / 2; fy0 = (fy0 + (yy & 1) * TILE) / 2; fsz /= 2;
      xx >>= 1; yy >>= 1; zz--;
    }
    return null;
  }
}

// World rect of a tile at level z.
export function tileWorldRect(z, x, y) {
  const s = Math.pow(2, MAX_Z - z) * TILE;
  return [x * s, y * s, Math.min(WORLD_W, (x + 1) * s), Math.min(WORLD_H, (y + 1) * s), s];
}
