// Paints the closed exterior ("Creation of the World") from its stroke files into an
// offscreen WebGL2 canvas, progressively, coarse level first. The stroke data comes from
// the same analyzer as the interior (WORLD=exterior, see tools/prepareExterior.ts).
import { createProgram, createQuad } from './gl.ts';
import { STROKE_VS, STROKE_FS } from './shaders.ts';
import { RECORD_BYTES } from '../shared/strokeModel.ts';
import { GROUND, TILE } from '../world.ts';
import type { Program } from './gl.ts';

export const EXT_W = 1402; // two painted areas side by side, source px
export const EXT_H = 1700;
export const EXT_SPLIT = 700; // the left shutter's painted width
const EXT_MAX_Z = 3;

// A stroke file of the exterior pyramid, with its strokes on the GPU once loaded.
interface ExtFile { z: number; x: number; y: number; scale: number; count: number; vbo: WebGLBuffer; vao: WebGLVertexArrayObject }

export class ExteriorPainter {
  k: number;
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  prog: Program;
  quad: WebGLBuffer;
  files: ExtFile[];
  total: number;
  drawn: number;
  strokeView: boolean;

  constructor(width: number) {
    this.k = width / EXT_W; // canvas px per source px
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(EXT_W * this.k);
    this.canvas.height = Math.round(EXT_H * this.k);
    const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.prog = createProgram(gl, STROKE_VS, STROKE_FS, 'exterior-stroke');
    this.quad = createQuad(gl);
    this.files = [];
    this.total = 0;
    this.drawn = 0;
    this.strokeView = false;
  }

  // Start over on a fresh ground (e.g. to repaint in the stroke view).
  reset(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(GROUND[0] / 255, GROUND[1] / 255, GROUND[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawn = 0;
  }

  async load(base = `${import.meta.env.BASE_URL}data/exterior/strokes`): Promise<void> {
    const gl = this.gl;
    const jobs: Partial<ExtFile>[] = [];
    for (let z = 0; z <= EXT_MAX_Z; z++) {
      const s = Math.pow(2, z - EXT_MAX_Z);
      const nx = Math.ceil(Math.ceil(EXT_W * s) / TILE), ny = Math.ceil(Math.ceil(EXT_H * s) / TILE);
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) jobs.push({ z, x, y, scale: this.k / s });
    }
    await Promise.all(jobs.map(async (f) => {
      const r = await fetch(`${base}/${f.z}/${f.x}_${f.y}.bin`);
      if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) throw new Error(`missing exterior strokes ${f.z}/${f.x}_${f.y}`);
      const buf = await r.arrayBuffer();
      f.count = buf.byteLength / RECORD_BYTES;
      f.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, f.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
      f.vao = gl.createVertexArray();
      gl.bindVertexArray(f.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      for (const loc of [1, 2, 3]) { gl.enableVertexAttribArray(loc); gl.vertexAttribDivisor(loc, 1); }
      gl.bindVertexArray(null);
    }));
    // paint order: level by level, files row-major, strokes in stored order
    this.files = (jobs as ExtFile[]).sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x); // every job is loaded now
    this.total = this.files.reduce((s, f) => s + f.count, 0);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(GROUND[0] / 255, GROUND[1] / 255, GROUND[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Paint strokes up to fraction p (0..1) of the total. Returns true when finished.
  paintTo(p: number): boolean {
    const gl = this.gl;
    const target = Math.min(this.total, Math.ceil(this.total * p));
    if (target <= this.drawn) return this.drawn >= this.total;
    gl.useProgram(this.prog.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.uniform2f(this.prog.u.u_dstSize, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.prog.u.u_fade, 1);
    gl.uniform1f(this.prog.u.u_strokeView, this.strokeView ? 1 : 0);
    let start = 0;
    for (const f of this.files) {
      const end = start + f.count;
      const a = Math.max(this.drawn, start), b = Math.min(target, end);
      if (b > a) {
        gl.uniform1f(this.prog.u.u_scale, f.scale);
        gl.uniform2f(this.prog.u.u_offset, f.x * TILE * f.scale, f.y * TILE * f.scale);
        gl.bindVertexArray(f.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, f.vbo);
        const off = (a - start) * RECORD_BYTES;
        gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, false, RECORD_BYTES, off);
        gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, RECORD_BYTES, off + 4);
        gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, RECORD_BYTES, off + 8);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b - a);
      }
      start = end;
      if (start >= target) break;
    }
    gl.bindVertexArray(null);
    this.drawn = target;
    return this.drawn >= this.total;
  }

  // Copy one shutter's painted area (source px rect sx..sx+sw) into a 2D context rect.
  // The GL canvas has its first row at the bottom, so it is drawn flipped.
  blit(ctx: CanvasRenderingContext2D, sx: number, sw: number, dx: number, dy: number, dw: number, dh: number): void {
    const k = this.k;
    ctx.save();
    ctx.translate(dx, dy + dh);
    ctx.scale(1, -1);
    ctx.drawImage(this.canvas, sx * k, 0, sw * k, this.canvas.height, 0, 0, dw, dh);
    ctx.restore();
  }

  dispose(): void {
    const gl = this.gl;
    for (const f of this.files) { gl.deleteBuffer(f.vbo); gl.deleteVertexArray(f.vao); }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
