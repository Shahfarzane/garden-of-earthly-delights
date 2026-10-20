import { Camera } from './engine/camera.ts';
import { attachInput } from './engine/input.ts';
import { Renderer } from './engine/renderer.ts';
import { Post } from './engine/post.ts';
import { UI } from './ui/ui.ts';
import { Shutters } from './ui/shutters.ts';
import { Soundscape } from './audio/soundscape.ts';
import { LifeLayer } from './living/layer.ts';
import { Animator } from './living/animator.ts';
import { RIGS } from './living/rigs.ts';
import type { Scene } from './scene.ts';

declare global {
  interface Window {
    // the running app, for the console and the verification scripts
    __garden: { camera: Camera; renderer: Renderer; post: Post; scene: Scene; ui: UI; sound: Soundscape; life: LifeLayer; animator: Animator; shutters: Shutters };
  }
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('paint') as HTMLCanvasElement; // index.html
const lifeCanvas = document.getElementById('life') as HTMLCanvasElement;
const camera = new Camera();
let renderer: Renderer;
try { renderer = new Renderer(canvas, camera); } catch (e) {
  // no WebGL2 (old browser, or hardware acceleration switched off): say so plainly
  const p = document.createElement('p');
  p.className = 'fallback';
  p.textContent = 'Mirage paints the painting with WebGL2, which this browser does not provide. Try a current version of Chrome, Safari, Firefox or Edge, with hardware acceleration on.';
  document.body.append(p);
  throw e;
}

function size() { camera.resize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', size);
size();

const scene: Scene = await (await fetch(`${import.meta.env.BASE_URL}data/scene.json`)).json();
// the framed triptych: its panels, inset where the frames sit over the scan's gaps (post.ts)
camera.setPainting({
  x0: Math.min(...scene.panels.map((p) => p.x0)) + 140, y0: Math.min(...scene.panels.map((p) => p.y0)) + 140,
  x1: Math.max(...scene.panels.map((p) => p.x1)) - 140, y1: Math.max(...scene.panels.map((p) => p.y1)) - 140,
});
await renderer.init();
const post = new Post(renderer.gl, renderer.quad, scene);
renderer.post = post;
post.loadEffects(`${import.meta.env.BASE_URL}data/effects.png`);
if (reduceMotion) { post.life = 0; renderer.tiles.instant = true; }

const animator = new Animator(RIGS);
const sound = new Soundscape(scene);
const life = new LifeLayer(lifeCanvas, camera, scene);
life.animator = animator;
const afterFrameQueue: (() => void)[] = [];
const afterFrame = (fn: () => void) => afterFrameQueue.push(fn);
const shutters = new Shutters({ camera, renderer, post, scene, afterFrame });

const ui = new UI({
  root: document.getElementById('ui')!, camera, renderer, post, scene,
  hooks: {
    async onSound(on) {
      if (!on) { sound.setMuted(true); return; }
      sound.setMuted(false);
      await sound.start().catch(() => {});
    },
    onSoundMode(mode) { sound.setMode(mode); },
    onStoryOpen(p) { sound.focus(p.id); sound.cue('poi'); },
    onStoryClose() { sound.focus(null); },
    onMotion(on) { life.enabled = on && !ui.closed; animator.enabled = on; },
    async onWings() {
      if (shutters.busy) return;
      const closing = shutters.state === 'open';
      if (closing) { ui.setClosed(true); life.enabled = false; }
      await shutters.toggle();
      if (!closing) { ui.setClosed(false); life.enabled = post.life > 0; }
    },
    onStrokeView(on) {
      renderer.tiles.setStrokeView(on);
      ui.miniImg = null;
      shutters.setStrokeView(on);
    },
    extraStrokes: () => shutters.strokes,
  },
});

const keyTick = attachInput(canvas, camera, {
  onTap: (sx, sy) => ui.tap(sx, sy),
  isEnabled: () => ui.enabled,
});
canvas.addEventListener('pointerdown', () => canvas.classList.add('dragging'));
window.addEventListener('pointerup', () => canvas.classList.remove('dragging'));
canvas.addEventListener('pointermove', (e) => { post.pointer = camera.screenToWorld(e.clientX, e.clientY); life.pointer = post.pointer; });
canvas.addEventListener('pointerleave', () => { life.pointer = null; });
// hold L: a raking lamp follows the pointer across the varnish
window.addEventListener('keydown', (e) => { if ((e.key === 'l' || e.key === 'L') && ui.enabled) post.rake = 1; });
window.addEventListener('keyup', (e) => { if (e.key === 'l' || e.key === 'L') post.rake = 0; });

// no gate: the triptych paints itself in, coarse strokes first
ui.setVisible(true);

// the frame loop pauses in a hidden tab, so pause the sound with it
document.addEventListener('visibilitychange', () => {
  if (!sound.context) return;
  if (document.hidden) sound.context.suspend();
  else if (ui.soundOn) sound.start().catch(() => {});
});

window.__garden = { camera, renderer, post, scene, ui, sound, life, animator, shutters };

// 60 fps is plenty for a living painting; on 120 Hz screens every other frame is skipped,
// halving GPU and battery cost. rAF timestamps jitter by a millisecond or two, so two 120 Hz
// frames can add up to less than 16.4 ms (1000 / 61), which skipped a third frame: 25 ms frames,
// one in eight at idle. The threshold sits at one and a half 120 Hz frames instead.
const MIN_FRAME_MS = 12.5;
let last = performance.now();
function loop(now: number) {
  // every animation frame, skipped or not: one that comes late after painting shrinks the stroke budget
  renderer.tiles.budget.tick(now);
  if (now - last < MIN_FRAME_MS) { requestAnimationFrame(loop); return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (window.innerWidth !== camera.w || window.innerHeight !== camera.h) size();
  keyTick(dt);
  camera.update(dt);
  if (post.tickFlash(renderer.time) && !ui.closed) {
    // thunder is as loud as the share of the view that Hell fills
    const v = camera.view();
    const seen = Math.max(0, Math.min(v.x1, 155552) - Math.max(v.x0, 119904)) / (v.x1 - v.x0);
    if (seen > 0.05) sound.cue('thunder', Math.min(1, seen * 1.3));
  }
  post.setRigs(ui.closed ? [] : animator.frame(camera, renderer.time, dt, life.pointer));
  renderer.frame(now, dt);
  while (afterFrameQueue.length) afterFrameQueue.shift()!();
  life.frame(dt, renderer.time);
  shutters.frame();
  ui.update();
  sound.update({ cx: camera.cx, cy: camera.cy, scale: camera.scale, viewW: camera.w, viewH: camera.h, time: renderer.time });
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
