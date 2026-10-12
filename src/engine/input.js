// Pointer, wheel, touch and keyboard navigation for the camera.
import { WORLD_W, WORLD_H } from '../world.js';

export function attachInput(el, camera, { onTap, onActivity, isEnabled = () => true } = {}) {
  const pointers = new Map();
  let samples = [];
  let pinch = null;
  let downAt = null;
  const keys = new Set();
  let gesturing = false;

  const pos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointers.set(e.pointerId, pos(e));
    camera.dragging = true;
    camera.vx = camera.vy = 0;
    camera.zoomTarget = null;
    camera.flight = null;
    samples = [];
    downAt = { p: pos(e), t: performance.now(), moved: false };
    if (pointers.size === 2) startPinch();
    onActivity?.();
  });

  function startPinch() {
    if (pointers.size !== 2) { pinch = null; return; }
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }

  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = pos(e);
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, p);
    if (downAt && Math.hypot(p[0] - downAt.p[0], p[1] - downAt.p[1]) > 5) downAt.moved = true;
    if (pointers.size === 1) {
      const dx = p[0] - prev[0], dy = p[1] - prev[1];
      camera.panBy(dx, dy);
      samples.push({ t: performance.now(), dx, dy });
      if (samples.length > 8) samples.shift();
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      camera.panBy(m[0] - pinch.m[0], m[1] - pinch.m[1]);
      camera.zoomAt(d / pinch.d, m[0], m[1], false);
      pinch = { d, m };
    }
    onActivity?.();
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) { pinch = null; samples = []; if (downAt) downAt.moved = true; return; }
    if (pointers.size === 0) {
      camera.dragging = false;
      pinch = null;
      const now = performance.now();
      const recent = samples.filter((s) => now - s.t < 90);
      if (recent.length >= 2) {
        const span = Math.max(16, now - recent[0].t);
        const dx = recent.reduce((a, s) => a + s.dx, 0), dy = recent.reduce((a, s) => a + s.dy, 0);
        camera.vx = -dx / span * 1000 / camera.scale;
        camera.vy = -dy / span * 1000 / camera.scale;
      }
      if (downAt && !downAt.moved && now - downAt.t < 450 && e.type === 'pointerup') onTap?.(...pos(e));
      downAt = null;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  // Wheel and trackpad gestures are handled on the window, whatever is under the pointer:
  // a pinch must never fall through to the browser's own page zoom. Scrollable panels
  // (the story text, popovers) keep plain scrolling.
  const scrollsItself = (t) => t instanceof Element && t.closest('.story, .pop, .minimap');
  window.addEventListener('wheel', (e) => {
    const pinch = e.ctrlKey || e.metaKey;
    if (!pinch && scrollsItself(e.target)) return;
    e.preventDefault();
    if (!isEnabled()) return;
    const [sx, sy] = pos(e);
    const lineMode = e.deltaMode === 1;
    const legacy = e.wheelDeltaY; // non-standard but present in Chromium and WebKit: +-120 per notch
    const notch = typeof legacy === 'number' && legacy !== 0 && legacy % 120 === 0;
    const mouseWheel = lineMode || (e.deltaX === 0 && !pinch && Number.isInteger(e.deltaY) && (Math.abs(e.deltaY) >= 40 || notch));
    if (pinch) {
      if (gesturing) return; // Safari already zooms this pinch through gesture events
      camera.zoomAt(Math.exp(-e.deltaY * 0.012), sx, sy, false);
    } else if (mouseWheel) {
      const steps = lineMode ? e.deltaY / 3 : e.deltaY / 100;
      camera.zoomAt(Math.exp(-steps * 0.35), sx, sy, true);
    } else {
      camera.panBy(-e.deltaX, -e.deltaY);
    }
    onActivity?.();
  }, { passive: false });

  el.addEventListener('dblclick', (e) => {
    const [sx, sy] = pos(e);
    camera.zoomAt(e.shiftKey || e.altKey ? 1 / 2.5 : 2.5, sx, sy, true);
    onActivity?.();
  });

  // Safari trackpad pinch
  let gscale = 1;
  window.addEventListener('gesturestart', (e) => { e.preventDefault(); gscale = 1; gesturing = true; });
  window.addEventListener('gestureend', (e) => { e.preventDefault(); gesturing = false; });
  window.addEventListener('gesturechange', (e) => {
    if (!isEnabled()) { e.preventDefault(); return; }
    e.preventDefault();
    const [sx, sy] = pos(e);
    camera.zoomAt(e.scale / gscale, sx, sy, false);
    gscale = e.scale;
  });

  window.addEventListener('keydown', (e) => {
    if (!isEnabled()) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey) return;
    keys.add(e.key.toLowerCase());
    const cxs = camera.w / 2, cys = camera.h / 2;
    if (e.key === '+' || e.key === '=') camera.zoomAt(1.6, cxs, cys, true);
    else if (e.key === '-' || e.key === '_') camera.zoomAt(1 / 1.6, cxs, cys, true);
    else if (e.key === '0') camera.flyTo(WORLD_W / 2, WORLD_H / 2, camera.fitScale);
    else return;
    onActivity?.();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  // continuous keyboard panning, called every frame
  return function tick(dt) {
    if (!isEnabled()) return;
    let dx = 0, dy = 0;
    if (keys.has('arrowleft') || keys.has('a')) dx += 1;
    if (keys.has('arrowright') || keys.has('d')) dx -= 1;
    if (keys.has('arrowup') || keys.has('w')) dy += 1;
    if (keys.has('arrowdown') || keys.has('s')) dy -= 1;
    if (dx || dy) { camera.panBy(dx * 900 * dt, dy * 900 * dt); onActivity?.(); }
  };
}
