// Frame loop glue: picks the level, requests tiles, paints, composites, post-processes.
import { createProgram, createQuad, createTexture, createFramebuffer } from './gl.ts';
import { TILE_VS, TILE_FS } from './shaders.ts';
import { StrokeStore } from './strokeStore.ts';
import { TileCache, tileWorldRect } from './tiles.ts';
import { levelTiles, MAX_Z, TILE } from '../world.ts';
import type { Camera } from './camera.ts';
import type { Program } from './gl.ts';
import type { Post } from './post.ts';

const Z_RENDER_MAX = 11;

// The offscreen buffer tiles are composited into, before the post pass. Physical px.
export interface SceneTarget { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
// What the post pass draws a frame with.
export interface FrameInfo { camera: Camera; dpr: number; time: number; zr: number }

export class Renderer {
  canvas: HTMLCanvasElement;
  camera: Camera;
  gl: WebGL2RenderingContext;
  quad: WebGLBuffer;
  store: StrokeStore;
  tiles: TileCache;
  tileProg: Program;
  instBuf: WebGLBuffer;
  tileVao: WebGLVertexArrayObject;
  inst: Float32Array;
  dpr: number;
  quality: number;
  scene: SceneTarget | null;
  post: Post | null;
  zr: number;
  time: number;
  lastPost?: FrameInfo;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.camera = camera;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.quad = createQuad(gl);
    this.store = new StrokeStore(gl, this.quad);
    this.tiles = new TileCache(gl, this.quad, this.store);
    this.tileProg = createProgram(gl, TILE_VS, TILE_FS, 'tile');
    this.instBuf = gl.createBuffer();
    this.tileVao = gl.createVertexArray();
    gl.bindVertexArray(this.tileVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.inst = new Float32Array(32 * 1024);
    this.dpr = 1;
    this.quality = 0; // level bias: +1 sharper, -1 faster
    this.scene = null;
    this.post = null; // set by main.ts
    this.zr = 0;
    this.time = 0;
  }

  async init(): Promise<void> { await this.store.init(); }

  resize(): void {
    const gl = this.gl;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.scene) return;
    this.canvas.width = w; this.canvas.height = h;
    if (this.scene) { gl.deleteTexture(this.scene.tex); gl.deleteFramebuffer(this.scene.fbo); }
    const tex = createTexture(gl, w, h);
    this.scene = { tex, fbo: createFramebuffer(gl, tex), w, h };
  }

  // Run the post pass again on the current scene (same frame, nothing re-composited).
  redrawPost(): void {
    if (this.post && this.lastPost) this.post.draw(this.gl, this.scene!, this.lastPost);
  }

  // How many strokes stand behind the current view: every loaded stroke file of the
  // levels being painted that touches the visible rect.
  strokesInView(): number {
    const v = this.camera.view();
    let n = 0;
    for (let z = 0; z <= Math.min(this.zr, this.store.maxZ); z++) {
      const s = Math.pow(2, MAX_Z - z) * TILE;
      const { nx, ny } = levelTiles(z);
      const x0 = Math.max(0, Math.floor(v.x0 / s)), x1 = Math.min(nx - 1, Math.floor(v.x1 / s));
      const y0 = Math.max(0, Math.floor(v.y0 / s)), y1 = Math.min(ny - 1, Math.floor(v.y1 / s));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const e = this.store.files.get(`${z}/${x}_${y}`);
        if (e && e.state === 'ready') n += e.count;
      }
    }
    return n;
  }

  renderLevel(): number {
    const c = this.camera;
    // bias toward the finer level: each level is a painterly approximation, so showing it
    // slightly minified looks much crisper than showing the coarser one magnified
    const z = Math.round(MAX_Z + Math.log2(c.scale * this.dpr) + 0.35 + this.quality);
    return Math.max(0, Math.min(Z_RENDER_MAX, z));
  }

  // Visible tile range at level z for the current view, padded by `pad` tiles.
  visibleRange(z: number, pad = 0): { x0: number; x1: number; y0: number; y1: number; s: number } {
    const v = this.camera.view();
    const s = Math.pow(2, MAX_Z - z) * TILE;
    const { nx, ny } = levelTiles(z);
    return {
      x0: Math.max(0, Math.floor(v.x0 / s) - pad), x1: Math.min(nx - 1, Math.floor(v.x1 / s) + pad),
      y0: Math.max(0, Math.floor(v.y0 / s) - pad), y1: Math.min(ny - 1, Math.floor(v.y1 / s) + pad),
      s,
    };
  }

  frame(now: number, dt: number): { zr: number; tiles: number } {
    const gl = this.gl;
    this.time += dt;
    this.resize();
    const scene = this.scene!; // resize() made it
    const c = this.camera;
    const zr = this.renderLevel();
    this.zr = zr;

    // base levels are always available as fallback
    for (let z = 0; z <= 2; z++) {
      const { nx, ny } = levelTiles(z);
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) this.tiles.request(z, x, y, -100 + z, true);
    }
    // a coarser safety net, then the real level, nearest the center first
    const cx = c.cx, cy = c.cy;
    for (const [z, base] of [[Math.max(3, zr - 2), 0], [zr, 1000]]) {
      if (z < 3 || z > zr) continue;
      const r = this.visibleRange(z, z === zr ? 0 : 0);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
        const d = Math.hypot((x + 0.5) * r.s - cx, (y + 0.5) * r.s - cy) / r.s;
        this.tiles.request(z, x, y, base + d);
      }
    }
    this.store.pump();
    this.tiles.paint(now);

    // composite visible tiles into the scene buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const r = this.visibleRange(zr);
    let n = 0;
    const k = this.dpr;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const src = this.tiles.source(zr, x, y);
      if (!src) continue;
      const [wx0, wy0, wx1, wy1, s] = tileWorldRect(zr, x, y);
      const fx = (wx1 - wx0) / s, fy = (wy1 - wy0) / s; // clip partial edge tiles
      const [u0, v0, u1, v1] = src.uv;
      const [sx0, sy0] = c.worldToScreen(wx0, wy0);
      const [sx1, sy1] = c.worldToScreen(wx1, wy1);
      if (n * 8 + 8 > this.inst.length) break;
      this.inst.set([sx0 * k, sy0 * k, sx1 * k, sy1 * k, u0, v0, u0 + (u1 - u0) * fx, v0 + (v1 - v0) * fy], n * 8);
      n++;
    }
    gl.useProgram(this.tileProg.program);
    gl.uniform2f(this.tileProg.u.u_view, scene.w, scene.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tiles.atlas);
    gl.uniform1i(this.tileProg.u.u_atlas, 0);
    gl.bindVertexArray(this.tileVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.subarray(0, n * 8), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // post: effects, varnish, frame; falls back to a straight blit
    gl.viewport(0, 0, scene.w, scene.h);
    this.lastPost = { camera: c, dpr: this.dpr, time: this.time, zr };
    if (this.post) this.post.draw(gl, scene, this.lastPost);
    else {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, scene.fbo);
      gl.blitFramebuffer(0, 0, scene.w, scene.h, 0, 0, scene.w, scene.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    }
    return { zr, tiles: n };
  }
}
