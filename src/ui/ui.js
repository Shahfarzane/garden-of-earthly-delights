// The interface around the painting, kept out of the way: quiet story markers, a story
// drawer, a control rail with sound and stroke popovers, the wings control and a minimap.
import { WORLD_W, WORLD_H } from '../world.js';

const ICON = {
  zoomIn: '<path d="M10 4.5v11M4.5 10h11"/>',
  zoomOut: '<path d="M4.5 10h11"/>',
  fit: '<path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/>',
  stories: '<circle cx="10" cy="10" r="2" fill="currentColor"/><circle cx="10" cy="10" r="6.5"/>',
  soundOn: '<path d="M3.5 8h3l4-3.5v11L6.5 12h-3z"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10"/>',
  soundOff: '<path d="M3.5 8h3l4-3.5v11L6.5 12h-3z"/><path d="M13.5 8l4 4M17.5 8l-4 4"/>',
  age: '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M3.5 9l4 1 2-3 3 2 4-1M8 16.5l1-6.5M12.5 9.5l1 7"/>',
  motion: '<path d="M2.5 11.5c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3"/><path d="M2.5 15.5c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3" opacity=".45"/>',
  full: '<path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/>',
  strokes: '<path d="M3 15.5c3-1 4.5-4.5 7.5-6s4.5-.5 6.5-3"/><path d="M3.5 11c2-.8 3-3.2 5.2-4.2" opacity=".5"/><path d="M8 17c2.4-.6 4.2-2.2 6.2-3.6" opacity=".5"/>',
  wings: '<rect x="7" y="3.5" width="6" height="13" rx="0.8"/><path d="M7 3.5 3 5v10l4 1.5M13 3.5 17 5v10l-4 1.5"/>',
  close: '<path d="M5 5l10 10M15 5 5 15"/>',
};
const svg = (name) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const PANEL_NAME = { eden: 'Paradise, left wing', garden: 'The garden, centre panel', hell: 'Hell, right wing' };
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  if (html) e.innerHTML = html;
  return e;
}

export class UI {
  constructor({ root, camera, renderer, post, scene, hooks = {} }) {
    this.root = root;
    this.camera = camera;
    this.renderer = renderer;
    this.post = post;
    this.scene = scene;
    this.hooks = hooks;
    this.pois = scene.pois.filter((p) => !p.overview);
    this.byId = new Map(scene.pois.map((p) => [p.id, p]));
    this.current = null;
    this.storiesOn = true;
    this.soundOn = false;
    this.soundMode = 'nature';
    this.strokeView = false;
    this.enabled = false;
    this.closed = false; // wings shut
    this.stats = null;
    this.build();
    fetch('data/strokes/stats.json').then((r) => (r.ok ? r.json() : null)).then((s) => { this.stats = s; }).catch(() => {});
  }

  build() {
    const r = this.root;
    // markers
    this.markerLayer = el('div', { class: 'markers' });
    this.markers = this.pois.map((p) => {
      const b = el('button', { class: 'poi', 'aria-label': `Story: ${p.title}` }, `<span class="tag">${p.title}</span>`);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.openStory(p); });
      this.markerLayer.append(b);
      return { p, b, shown: false };
    });
    // story drawer
    this.story = el('aside', { class: 'story', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'story-title', 'aria-hidden': 'true' });
    this.story.innerHTML = `
      <header><p class="where"></p><h2 id="story-title"></h2></header>
      <button class="close" aria-label="Close story">${svg('close')}</button>
      <div class="body" tabindex="0"></div>`;
    this.story.querySelector('.close').addEventListener('click', () => this.closeStory());
    // rail
    this.rail = el('nav', { class: 'rail', 'aria-label': 'Painting controls' });
    const btn = (name, label, fn, cls = '') => {
      const b = el('button', { 'aria-label': label, class: cls }, `${svg(name)}<span class="tip">${label}</span>`);
      b.addEventListener('click', fn);
      this.rail.append(b);
      return b;
    };
    const sep = (cls = '') => this.rail.append(el('span', { class: `sep ${cls}` }));
    btn('zoomOut', 'Zoom out', () => this.camera.zoomAt(1 / 1.8, this.camera.w / 2, this.camera.h / 2));
    btn('zoomIn', 'Zoom in', () => this.camera.zoomAt(1.8, this.camera.w / 2, this.camera.h / 2));
    btn('fit', 'Whole painting', () => this.camera.flyTo(WORLD_W / 2, WORLD_H / 2, this.camera.fitScale));
    sep();
    this.wingsBtn = btn('wings', 'Close the wings', () => this.hooks.onWings?.());
    this.strokesBtn = btn('strokes', 'Brush strokes', () => this.togglePop('strokes'));
    sep('opt-btn');
    this.storiesBtn = btn('stories', 'Story markers', () => this.setStories(!this.storiesOn), 'opt-btn');
    this.motionBtn = btn('motion', 'Living painting', () => this.setMotion(this.post.life < 0.5), 'opt-btn');
    this.ageBtn = btn('age', 'Varnish and cracks', () => this.setAge(this.post.age < 0.5), 'opt-btn');
    btn('full', 'Full screen', () => this.toggleFullscreen(), 'opt-btn');
    sep();
    this.soundBtn = btn('soundOff', 'Sound', () => this.togglePop('sound'));
    this.storiesBtn.setAttribute('aria-pressed', 'true');
    this.motionBtn.setAttribute('aria-pressed', 'true');
    this.ageBtn.setAttribute('aria-pressed', 'true');
    for (const b of [this.strokesBtn, this.soundBtn]) b.setAttribute('aria-expanded', 'false');

    // sound popover
    this.soundPop = el('div', { class: 'pop', role: 'dialog', 'aria-label': 'Sound' });
    this.soundPop.innerHTML = `<h4>Sound</h4>
      <div role="radiogroup">
        <button class="opt" role="radio" data-mode="off"><span class="dot"></span><span>Off</span></button>
        <button class="opt" role="radio" data-mode="nature"><span class="dot"></span><span>Nature<small>Birds, water, wind and fire where you look</small></span></button>
        <button class="opt" role="radio" data-mode="period"><span class="dot"></span><span>Period music<small>Lute, recorder and viol, about 1500, with the nature sounds</small></span></button>
      </div>`;
    for (const o of this.soundPop.querySelectorAll('.opt')) o.addEventListener('click', () => this.chooseSound(o.dataset.mode));
    // strokes popover
    this.strokesPop = el('div', { class: 'pop', role: 'dialog', 'aria-label': 'Brush strokes' });
    this.strokesPop.innerHTML = `<h4>Brush strokes</h4>
      <dl class="stats">
        <div class="big"><b data-k="total">…</b><span>strokes paint this triptych</span></div>
        <dt>Whole painting</dt><dd data-k="base">…</dd>
        <dt>Deep detail</dt><dd data-k="deep">…</dd>
        <dt>Closed shutters</dt><dd data-k="ext">…</dd>
        <dt>Behind this view</dt><dd data-k="view">…</dd>
        <dt>Painted this visit</dt><dd data-k="session">…</dd>
        <dt>Screen pixels</dt><dd data-k="px">…</dd>
      </dl>
      <button class="switch" role="switch" aria-checked="false"><span>Show the strokes<small>Each stroke in its own colour</small></span><span class="track"></span></button>`;
    this.strokeSwitch = this.strokesPop.querySelector('.switch');
    this.strokeSwitch.addEventListener('click', () => this.setStrokeView(!this.strokeView));

    // minimap
    this.mini = el('div', { class: 'minimap' });
    this.miniCanvas = el('canvas', { width: 400, height: 228, 'aria-label': 'Overview map; click to move there' });
    this.mini.append(this.miniCanvas);
    this.miniImg = null;
    const miniNav = (e, smooth) => {
      const rc = this.miniCanvas.getBoundingClientRect();
      const x = (e.clientX - rc.left) / rc.width * WORLD_W, y = (e.clientY - rc.top) / rc.height * WORLD_H;
      if (smooth) this.camera.flyTo(x, y, Math.max(this.camera.scale, this.camera.fitScale * 2.5), { duration: 900 });
      else { this.camera.flight = null; this.camera.cx = x; this.camera.cy = y; this.camera.interacted = true; this.camera.emit(); }
    };
    let miniDrag = false;
    this.miniCanvas.addEventListener('pointerdown', (e) => { miniDrag = true; this.miniCanvas.setPointerCapture(e.pointerId); miniNav(e, true); });
    this.miniCanvas.addEventListener('pointermove', (e) => { if (miniDrag && e.buttons) miniNav(e, false); });
    this.miniCanvas.addEventListener('pointerup', () => { miniDrag = false; });

    r.append(this.markerLayer, this.mini, this.soundPop, this.strokesPop, this.rail, this.story);
    this.setSoundUI();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (this.openPop) this.togglePop(this.openPop); else this.closeStory(); }
    });
    window.addEventListener('pointerdown', (e) => {
      if (this.openPop && !e.target.closest('.pop') && !e.target.closest('.rail')) this.togglePop(this.openPop);
    });
  }

  setVisible(on) {
    this.enabled = on;
    for (const n of [this.rail, this.mini, this.markerLayer]) n.style.display = on ? '' : 'none';
    if (on && !this.linkChecked) {
      this.linkChecked = true;
      const id = new URLSearchParams(location.hash.slice(1)).get('story');
      const p = id && this.byId.get(id);
      if (p) setTimeout(() => this.openStory(p), 400);
    }
  }

  // ---------- popovers ----------
  togglePop(name) {
    const pops = { sound: [this.soundPop, this.soundBtn], strokes: [this.strokesPop, this.strokesBtn] };
    for (const [k, [pop, b]] of Object.entries(pops)) {
      const open = k === name && this.openPop !== name;
      pop.classList.toggle('open', open);
      b.setAttribute('aria-expanded', String(open));
    }
    this.openPop = this.openPop === name ? null : name;
    if (this.openPop === 'strokes') this.updateStats(true);
  }

  chooseSound(mode) {
    if (mode === 'off') { this.soundOn = false; this.hooks.onSound?.(false); }
    else { this.soundMode = mode; this.soundOn = true; this.hooks.onSoundMode?.(mode); this.hooks.onSound?.(true); }
    this.setSoundUI();
  }
  setSound(on) { this.soundOn = on; this.hooks.onSound?.(on); this.setSoundUI(); }
  setSoundUI() {
    const current = this.soundOn ? this.soundMode : 'off';
    for (const o of this.soundPop.querySelectorAll('.opt')) o.setAttribute('aria-checked', String(o.dataset.mode === current));
    this.soundBtn.innerHTML = `${svg(this.soundOn ? 'soundOn' : 'soundOff')}<span class="tip">Sound</span>`;
  }

  setStrokeView(on) {
    this.strokeView = on;
    this.strokeSwitch.setAttribute('aria-checked', String(on));
    this.hooks.onStrokeView?.(on);
  }

  updateStats(force = false) {
    const now = performance.now();
    if (!force && now - (this.lastStats || 0) < 300) return;
    this.lastStats = now;
    const set = (k, v) => { const n = this.strokesPop.querySelector(`[data-k="${k}"]`); if (n) n.textContent = v; };
    const s = this.stats;
    if (s) {
      set('total', fmt(s.total + (s.exterior || 0)));
      set('base', fmt(s.base));
      set('deep', fmt(s.deep));
      set('ext', s.exterior ? fmt(s.exterior) : 'not painted');
    }
    set('view', fmt(this.renderer.strokesInView()));
    set('session', fmt(this.renderer.tiles.totalStrokes + (this.hooks.extraStrokes?.() || 0)));
    const c = this.renderer.canvas;
    set('px', `${fmt(c.width * c.height)} (${c.width} × ${c.height})`);
  }

  // ---------- story ----------
  openStory(p, { fly = true } = {}) {
    if (!p || this.closed) return;
    this.current = p;
    const s = this.story;
    s.querySelector('.where').textContent = PANEL_NAME[p.panel];
    s.querySelector('h2').textContent = p.title;
    const body = s.querySelector('.body');
    body.innerHTML = '';
    for (const para of p.text.split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean)) {
      const pe = el('p'); pe.textContent = para; body.append(pe);
    }
    body.scrollTop = 0;
    s.classList.add('open');
    s.setAttribute('aria-hidden', 'false');
    document.body.classList.add('reading');
    for (const m of this.markers) m.b.classList.toggle('active', m.p === p);
    if (fly) this.flyToPoi(p);
    history.replaceState(null, '', `#story=${p.id}`);
    this.hooks.onStoryOpen?.(p);
  }

  closeStory() {
    if (!this.current) return;
    this.current = null;
    this.story.classList.remove('open');
    this.story.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('reading');
    for (const m of this.markers) m.b.classList.remove('active');
    history.replaceState(null, '', location.pathname + location.search);
    this.hooks.onStoryClose?.();
  }

  drawerInset() {
    if (!this.current) return { x: 0, y: 0 };
    if (window.innerWidth <= 720) return { x: 0, y: Math.min(window.innerHeight * 0.62, 560) + 8 };
    return { x: Math.min(420, window.innerWidth - 24) + 24, y: 0 };
  }

  flyToPoi(p) {
    const c = this.camera;
    const inset = this.drawerInset();
    const aw = c.w - inset.x, ah = c.h - inset.y;
    const scale = Math.max(c.fitScale * 0.9, Math.min(c.maxScale, Math.min(aw, ah) * 0.42 / p.r));
    c.flyTo(p.x + inset.x / 2 / scale, p.y + inset.y / 2 / scale, scale);
  }

  // ---------- toggles ----------
  setStories(on) {
    this.storiesOn = on;
    this.storiesBtn.setAttribute('aria-pressed', String(on));
    this.markerLayer.classList.toggle('hidden', !on);
  }
  setMotion(on) {
    this.post.life = on ? 1 : 0;
    this.motionBtn.setAttribute('aria-pressed', String(on));
    this.hooks.onMotion?.(on);
  }
  setAge(on) {
    this.post.age = on ? 1 : 0;
    this.ageBtn.setAttribute('aria-pressed', String(on));
  }
  setClosed(closed) {
    this.closed = closed;
    this.wingsBtn.querySelector('.tip').textContent = closed ? 'Open the wings' : 'Close the wings';
    this.wingsBtn.setAttribute('aria-label', closed ? 'Open the wings' : 'Close the wings');
    this.wingsBtn.setAttribute('aria-pressed', String(closed));
    this.markerLayer.style.visibility = closed ? 'hidden' : '';
    if (closed) this.closeStory();
  }
  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }

  // Tap on the painting: open the smallest story circle under the finger.
  tap(sx, sy) {
    if (!this.enabled || this.closed || !this.storiesOn) return false;
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    let best = null;
    for (const p of this.pois) {
      const d = Math.hypot(wx - p.x, wy - p.y);
      if (d < p.r * 0.85 && p.r * this.camera.scale > 40 && (!best || p.r < best.r)) best = p;
    }
    if (best) { this.openStory(best, { fly: false }); return true; }
    return false;
  }

  // ---------- per frame ----------
  update() {
    if (!this.enabled) return;
    const c = this.camera;
    const minDim = Math.min(c.w, c.h);
    for (const m of this.markers) {
      const [sx, sy] = c.worldToScreen(m.p.x, m.p.y);
      const rpx = m.p.r * c.scale;
      // quiet: only once you are close enough for the story to be legible, gone when inside it
      const show = this.storiesOn && rpx > 70 && rpx < minDim * 0.8 && sx > -20 && sy > -20 && sx < c.w + 20 && sy < c.h + 20;
      if (show !== m.shown) { m.b.style.display = show ? '' : 'none'; m.shown = show; }
      if (show) m.b.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    }
    const away = c.scale < c.fitScale * 1.35 || this.closed;
    if (away !== this.miniAway) { this.mini.classList.toggle('away', away); this.miniAway = away; }
    if (!away) this.drawMinimap();
    if (this.openPop === 'strokes') this.updateStats();
  }

  // Minimap painted from the stroke atlas (level-2 tiles), plus the view rectangle.
  drawMinimap() {
    const cv = this.miniCanvas, ctx = cv.getContext('2d');
    if (!this.miniImg) this.miniImg = this.captureMini();
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (this.miniImg) ctx.drawImage(this.miniImg, 0, 0, cv.width, cv.height);
    else { ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, 0, cv.width, cv.height); }
    const v = this.camera.view();
    const sx = cv.width / WORLD_W, sy = cv.height / WORLD_H;
    const x0 = Math.max(0, v.x0 * sx), y0 = Math.max(0, v.y0 * sy), x1 = Math.min(cv.width, v.x1 * sx), y1 = Math.min(cv.height, v.y1 * sy);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, cv.width, y0); ctx.fillRect(0, y1, cv.width, cv.height - y1);
    ctx.fillRect(0, y0, x0, y1 - y0); ctx.fillRect(x1, y0, cv.width - x1, y1 - y0);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, Math.max(3, x1 - x0 - 2), Math.max(3, y1 - y0 - 2));
  }

  captureMini() {
    const tiles = this.renderer.tiles;
    if (this.strokeView) return null;
    const need = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
      const t = tiles.tiles.get(`2/${x}/${y}`);
      if (!t || t.state !== 'done') return null;
      need.push(t);
    }
    const gl = this.renderer.gl;
    const W = 5 * 256, H = 3 * 256;
    const img = new ImageData(W, H);
    const px = new Uint8Array(256 * 256 * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tiles.fbo);
    for (const t of need) {
      const [u0, v0] = tiles.uvRect(t);
      gl.readPixels(Math.round(u0 * tiles.size), Math.round(v0 * tiles.size), 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let row = 0; row < 256; row++) img.data.set(px.subarray(row * 1024, row * 1024 + 1024), ((t.y * 256 + row) * W + t.x * 256) * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = document.createElement('canvas');
    c.width = Math.ceil(WORLD_W / 128); c.height = Math.ceil(WORLD_H / 128);
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }
}
