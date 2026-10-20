// The wings. Closing swings both shutters 180 degrees on their hinges over the centre panel,
// revealing Bosch's grisaille exterior ("Creation of the World"), painted from its own
// stroke data; the closed triptych stays on the board and can be explored like the rest.
// A shutter's back face is a capture of its freshly painted wing, so when it opens again it
// lands exactly on the live painting underneath.
import { ExteriorPainter, EXT_W, EXT_H, EXT_SPLIT } from '../engine/exteriorPainter.ts';
import { WORLD_W, WORLD_H } from '../world.ts';
import type { Rect } from '../world.ts';
import type { Camera } from '../engine/camera.ts';
import type { Post } from '../engine/post.ts';
import type { Renderer } from '../engine/renderer.ts';
import type { Scene } from '../scene.ts';

const SWING_MS = 2600;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Shutters {
  camera: Camera;
  renderer: Renderer;
  post: Post;
  afterFrame: (fn: () => void) => void; // runs fn right after the next frame is drawn
  state: 'open' | 'closing' | 'closed' | 'opening';
  C: Rect; // the centre panel, inside the frame
  L: { x0: number; x1: number }; // the wings' spans, world px
  R: { x0: number; x1: number };
  painter: ExteriorPainter | null;
  strokeView: boolean;
  root: HTMLDivElement | null; // built on the first close
  p: number;
  sl!: HTMLElement; // the shutters and their faces, made with root
  sr!: HTMLElement;
  fronts!: HTMLCanvasElement[];
  backs!: HTMLCanvasElement[];

  constructor({ camera, renderer, post, scene, afterFrame }: { camera: Camera; renderer: Renderer; post: Post; scene: Scene; afterFrame: (fn: () => void) => void }) {
    this.camera = camera;
    this.renderer = renderer;
    this.post = post;
    this.afterFrame = afterFrame;
    this.state = 'open'; // open | closing | closed | opening
    const inset = 140; // matches the frame inset in post.ts
    const [eden, centre, hell] = scene.panels;
    this.C = { x0: centre.x0 + inset, x1: centre.x1 - inset, y0: centre.y0 + inset, y1: centre.y1 - inset };
    this.L = { x0: eden.x0 + inset, x1: eden.x1 - inset };
    this.R = { x0: hell.x0 + inset, x1: hell.x1 - inset };
    this.painter = null;
    this.strokeView = false;
    this.root = null;
    this.p = 1; // 0 closed .. 1 open
  }

  get busy(): boolean { return this.state === 'closing' || this.state === 'opening'; }
  get strokes(): number { return this.painter ? this.painter.drawn : 0; }

  toggle(): Promise<void> {
    if (this.busy) return Promise.resolve();
    return this.state === 'open' ? this.close() : this.open();
  }

  build(): void {
    const root = document.createElement('div');
    root.className = 'shutters';
    root.innerHTML = `
      <div class="shutter l"><div class="face front"><canvas></canvas></div><div class="face back"><canvas></canvas></div></div>
      <div class="shutter r"><div class="face front"><canvas></canvas></div><div class="face back"><canvas></canvas></div></div>`;
    document.body.insertBefore(root, document.getElementById('ui'));
    this.root = root;
    [this.sl, this.sr] = root.querySelectorAll<HTMLElement>('.shutter');
    this.fronts = [this.sl.querySelector<HTMLCanvasElement>('.front canvas')!, this.sr.querySelector<HTMLCanvasElement>('.front canvas')!];
    this.backs = [this.sl.querySelector<HTMLCanvasElement>('.back canvas')!, this.sr.querySelector<HTMLCanvasElement>('.back canvas')!];
  }

  // Paint the exterior (once, and again when the stroke view is switched) into both faces.
  async paintFaces(): Promise<void> {
    if (!this.painter) {
      this.painter = new ExteriorPainter(EXT_W * 2); // twice the photo's resolution: crisp brushwork when zoomed
      await this.painter.load();
    } else this.painter.reset();
    this.painter.strokeView = this.strokeView;
    this.painter.paintTo(1);
    const fh = Math.round((EXT_H * 2) / 0.92), fw = Math.round(fh * ((this.C.x1 - this.C.x0) / 2) / (this.C.y1 - this.C.y0));
    for (const [i, cv] of this.fronts.entries()) {
      cv.width = fw; cv.height = fh;
      const ctx = cv.getContext('2d')!;
      this.paintFrame(ctx, fw, fh, i);
      const sg = this.sight(i, fw, fh);
      const sx = i === 0 ? 0 : EXT_SPLIT, sw = i === 0 ? EXT_SPLIT : EXT_W - EXT_SPLIT;
      this.painter.blit(ctx, sx, sw, sg.x, sg.y, sg.w, sg.h);
    }
  }

  async setStrokeView(on: boolean): Promise<void> {
    this.strokeView = on;
    if (this.painter) await this.paintFaces();
  }

  // Painted-area rect inside shutter i's face, from the photo's proportions.
  sight(i: number, fw: number, fh: number): { x: number; y: number; w: number; h: number } {
    const fv = fh * 0.04;
    const ph = fh - 2 * fv;
    const pw = ph * ((i === 0 ? EXT_SPLIT : EXT_W - EXT_SPLIT) / EXT_H);
    return { x: (fw - pw) / 2, y: fv, w: pw, h: ph };
  }

  // The shutter's own frame: near-black oak with a fine gilt line at the edge and at the sight.
  paintFrame(ctx: CanvasRenderingContext2D, fw: number, fh: number, i: number): void {
    const g = ctx.createLinearGradient(0, 0, fw, fh);
    g.addColorStop(0, '#1d1814'); g.addColorStop(0.5, '#141110'); g.addColorStop(1, '#0d0b0a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, fw, fh);
    let seed = 17 + i * 31;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.globalAlpha = 0.05;
    for (let n = 0; n < 220; n++) {
      ctx.strokeStyle = rnd() < 0.5 ? '#000' : '#4a3a2a';
      ctx.lineWidth = 1 + rnd() * 3;
      ctx.beginPath();
      if (rnd() < 0.6) { const x = rnd() * fw; ctx.moveTo(x, 0); ctx.bezierCurveTo(x + rnd() * 10 - 5, fh * 0.3, x + rnd() * 10 - 5, fh * 0.7, x + rnd() * 6 - 3, fh); }
      else { const y = rnd() * fh; ctx.moveTo(0, y); ctx.bezierCurveTo(fw * 0.3, y + rnd() * 6 - 3, fw * 0.7, y + rnd() * 6 - 3, fw, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const sg = this.sight(i, fw, fh);
    const u = fw / 420;
    const gilt = (x: number, y: number, w: number, h: number, lw: number) => {
      const gg = ctx.createLinearGradient(x, y, x + w, y + h);
      gg.addColorStop(0, '#b89a58'); gg.addColorStop(0.5, '#7c612b'); gg.addColorStop(1, '#c5a865');
      ctx.strokeStyle = gg; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h);
    };
    gilt(u * 3, u * 3, fw - u * 6, fh - u * 6, u * 1.4);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sg.x - u * 4, sg.y - u * 4, sg.w + u * 8, sg.h + u * 8);
    gilt(sg.x - u * 2, sg.y - u * 2, sg.w + u * 4, sg.h + u * 4, u * 2);
  }

  // Shutter positions from the current camera; p: 0 closed .. 1 open.
  place(): void {
    const s = (x: number, y: number) => this.camera.worldToScreen(x, y);
    const [cx0, cy0] = s(this.C.x0, this.C.y0), [cx1, cy1] = s(this.C.x1, this.C.y1);
    const [lx0] = s(this.L.x0, 0), [lx1] = s(this.L.x1, 0), [rx0] = s(this.R.x0, 0), [rx1] = s(this.R.x1, 0);
    const e = ease(this.p);
    const half = (cx1 - cx0) / 2, h = cy1 - cy0;
    const wL = half + (lx1 - lx0 - half) * e, wR = half + (rx1 - rx0 - half) * e;
    const dL = (lx1 - cx0) * e, dR = (rx0 - cx1) * e;
    // shut, they are the painting the fixed frame shows: clipped to its opening as the camera zooms;
    // inside a hugging frame they swing behind it too
    if (this.state === 'closed' || this.camera.hug) { const O = this.camera.opening(); this.root!.style.clipPath = `inset(${O.y0}px ${this.camera.w - O.x1}px ${this.camera.h - O.y1}px ${O.x0}px)`; }
    else this.root!.style.clipPath = '';
    this.root!.style.perspective = `${Math.round((cx1 - cx0) * 2.4)}px`;
    this.root!.style.perspectiveOrigin = `${(cx0 + cx1) / 2}px ${(cy0 + cy1) / 2}px`;
    this.sl.style.cssText = `left:${cx0}px;top:${cy0}px;width:${wL}px;height:${h}px;transform-origin:0 50%;transform:translateX(${dL}px) rotateY(${-180 * e}deg)`;
    this.sr.style.cssText = `left:${cx1 - wR}px;top:${cy0}px;width:${wR}px;height:${h}px;transform-origin:100% 50%;transform:translateX(${dR}px) rotateY(${180 * e}deg)`;
  }

  // Back faces: the painted wings, captured from the WebGL canvas right after a frame.
  captureWings(): void {
    const src = this.renderer.canvas, k = this.renderer.dpr, cam = this.camera;
    const [ex0, ey0] = cam.worldToScreen(this.L.x0, this.C.y0), [ex1, ey1] = cam.worldToScreen(this.L.x1, this.C.y1);
    const [hx0] = cam.worldToScreen(this.R.x0, 0), [hx1] = cam.worldToScreen(this.R.x1, 0);
    for (const [cv, x0, x1] of [[this.backs[0], ex0, ex1], [this.backs[1], hx0, hx1]] satisfies [HTMLCanvasElement, number, number][]) {
      cv.width = Math.round((x1 - x0) * k); cv.height = Math.round((ey1 - ey0) * k);
      cv.getContext('2d')!.drawImage(src, x0 * k, ey0 * k, (x1 - x0) * k, (ey1 - ey0) * k, 0, 0, cv.width, cv.height);
    }
  }

  async whole(): Promise<void> {
    const c = this.camera;
    await new Promise<void>((res) => c.flyTo(WORLD_W / 2, WORLD_H / 2, c.fitScale, { duration: 900, done: res }));
    // wait until the wings are painted at this level, then grab them right after a frame
    await new Promise<void>((res) => {
      const check = () => {
        const tc = this.renderer.tiles, z = this.renderer.zr;
        let ready = true;
        for (const t of tc.tiles.values()) if (t.z === z && t.state !== 'done' && t.lastUsed >= tc.frame - 2) ready = false;
        // the wings may be hidden (shutters closed): show them for one redraw of the post pass,
        // capture, then hide them again, all before the frame is presented
        if (ready) this.afterFrame(() => {
          const hidden = this.post.hideWings;
          if (hidden) { this.post.hideWings = 0; this.renderer.redrawPost(); }
          this.captureWings();
          if (hidden) { this.post.hideWings = hidden; this.renderer.redrawPost(); }
          res();
        });
        else setTimeout(check, 100);
      };
      check();
    });
  }

  swing(from: number, to: number): Promise<void> {
    return new Promise<void>((res) => {
      const t0 = performance.now();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const tick = (now: number) => {
        const u = reduce ? 1 : Math.min(1, (now - t0) / SWING_MS);
        this.p = from + (to - from) * u;
        this.place();
        if (u < 1) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
  }

  async close(): Promise<void> {
    this.state = 'closing';
    if (!this.root) this.build();
    const painting = this.paintFaces();
    await this.whole();
    await painting;
    this.root!.style.display = '';
    this.p = 1; this.place();
    this.post.hideWings = 1;
    await this.swing(1, 0);
    this.state = 'closed';
    this.camera.setFramed(this.C);
  }

  async open(): Promise<void> {
    this.state = 'opening';
    this.camera.setFramed(this.camera.painting);
    await this.whole();
    await this.swing(0, 1);
    this.post.hideWings = 0;
    this.root!.style.display = 'none';
    this.state = 'open';
  }

  // Keep the closed shutters glued to the board while the camera moves.
  frame(): void {
    if (this.root && this.state === 'closed') this.place();
  }
}
