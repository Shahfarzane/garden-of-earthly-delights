// Fetches stroke tile files and keeps them as instanced vertex arrays on the GPU.
import { RECORD_BYTES } from '../shared/strokeModel.ts';
import { FULL_Z, levelTiles } from '../world.ts';

const MAX_INFLIGHT = 10;
const GPU_BUDGET = (window.matchMedia('(pointer: coarse)').matches ? 160 : 512) * 1024 * 1024;

export type FileState = 'idle' | 'queued' | 'loading' | 'ready' | 'missing';

// One stroke file of the pyramid. An evicted file goes back to 'idle' and keeps its identity.
export interface StrokeFile {
  key: string; z: number; x: number; y: number;
  state: FileState;
  vao: WebGLVertexArrayObject | null; vbo: WebGLBuffer | null;
  count: number; // stroke records
  bytes: number;
  lastUsed: number; // the store frame it was last asked for
  priority: number; // lower loads sooner
}

// manifest.json: which tiles of the levels past FULL_Z hold strokes, as "x_y" per level
interface Manifest { deep?: Record<string, string[]> }

export class StrokeStore {
  gl: WebGL2RenderingContext;
  quad: WebGLBuffer;
  base: string;
  files: Map<string, StrokeFile>;
  queue: StrokeFile[];
  inflight: number;
  bytes: number;
  deep: Map<number, Set<string>>;
  maxZ: number;
  frame: number;
  onReady: ((e: StrokeFile) => void) | null;

  constructor(gl: WebGL2RenderingContext, quadBuf: WebGLBuffer, base = `${import.meta.env.BASE_URL}data/strokes`) {
    this.gl = gl;
    this.quad = quadBuf;
    this.base = base;
    this.files = new Map();
    this.queue = [];
    this.inflight = 0;
    this.bytes = 0;
    this.deep = new Map(); // z -> Set("x_y") for levels beyond FULL_Z
    this.maxZ = FULL_Z;
    this.frame = 0;
    this.onReady = null;
  }

  async init(): Promise<void> {
    try {
      const r = await fetch(`${this.base}/manifest.json`);
      if (r.ok) {
        const m: Manifest = await r.json();
        for (const [z, list] of Object.entries(m.deep || {})) {
          this.deep.set(Number(z), new Set(list));
          this.maxZ = Math.max(this.maxZ, Number(z));
        }
      }
    } catch { /* no deep levels */ }
  }

  exists(z: number, x: number, y: number): boolean {
    if (z <= FULL_Z) {
      const { nx, ny } = levelTiles(z);
      return x >= 0 && y >= 0 && x < nx && y < ny;
    }
    return this.deep.get(z)?.has(`${x}_${y}`) ?? false;
  }

  // Returns the entry, scheduling a fetch if needed. priority: lower = sooner.
  get(z: number, x: number, y: number, priority = 0): StrokeFile {
    const key = `${z}/${x}_${y}`;
    let e = this.files.get(key);
    if (!e) {
      e = { key, z, x, y, state: 'idle', vao: null, vbo: null, count: 0, bytes: 0, lastUsed: this.frame, priority };
      this.files.set(key, e);
      if (!this.exists(z, x, y)) e.state = 'missing';
      else { e.state = 'queued'; this.queue.push(e); }
    }
    // an evicted entry keeps its identity (tiles hold references to it) and reloads on demand
    if (e.state === 'idle') { e.state = 'queued'; e.priority = priority; this.queue.push(e); }
    e.lastUsed = this.frame;
    if (e.state === 'queued') e.priority = Math.min(e.priority, priority);
    return e;
  }

  pump(): void {
    this.frame++;
    if (this.queue.length && this.inflight < MAX_INFLIGHT) {
      this.queue.sort((a, b) => a.priority - b.priority);
      while (this.queue.length && this.inflight < MAX_INFLIGHT) this.load(this.queue.shift()!);
    }
    // reset priorities so stale requests don't keep their urgency
    for (const e of this.queue) e.priority += 1;
    if (this.bytes > GPU_BUDGET) this.evict();
  }

  async load(e: StrokeFile): Promise<void> {
    e.state = 'loading';
    this.inflight++;
    try {
      const r = await fetch(`${this.base}/${e.z}/${e.x}_${e.y}.bin`);
      // dev servers answer missing files with index.html; only accept real stroke records
      if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) throw new Error(String(r.status));
      const buf = await r.arrayBuffer();
      if (buf.byteLength % RECORD_BYTES !== 0) throw new Error('bad stroke file');
      this.upload(e, buf);
      e.state = 'ready';
    } catch {
      e.state = 'missing';
    }
    this.inflight--;
    this.onReady?.(e);
  }

  upload(e: StrokeFile, buf: ArrayBuffer): void {
    const gl = this.gl;
    e.count = buf.byteLength / RECORD_BYTES;
    e.bytes = buf.byteLength;
    if (!e.count) return;
    e.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, e.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
    e.vao = gl.createVertexArray();
    gl.bindVertexArray(e.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, e.vbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, false, RECORD_BYTES, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, RECORD_BYTES, 4);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, RECORD_BYTES, 8);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    this.bytes += e.bytes;
  }

  evict(): void {
    const gl = this.gl;
    const ready = [...this.files.values()].filter((e) => e.state === 'ready' && e.z > 2 && this.frame - e.lastUsed > 120);
    ready.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of ready) {
      if (this.bytes <= GPU_BUDGET * 0.8) break;
      if (e.vao) gl.deleteVertexArray(e.vao);
      if (e.vbo) gl.deleteBuffer(e.vbo);
      this.bytes -= e.bytes;
      // keep the entry: tiles still reference it and must see it as not ready
      e.vao = e.vbo = null;
      e.count = 0; e.bytes = 0;
      e.state = 'idle';
    }
  }
}
