// The interface around the painting, in Mirage's design (docs/plan.md, Round 7): breadcrumbs back to
// the Mirage index, the painting's buttons and the menu top right, zoom bottom right, quiet story
// markers, a story drawer, the sound and strokes panels and a minimap.
import { WORLD_W, WORLD_H } from '../world.js';

// The Mirage index: the root of the site the Garden is a path of (site.config.js).
export const MIRAGE_URL = '/';
const SOURCE_URL = 'https://github.com/Shahfarzane/garden-of-earthly-delights';

// the icons are characters of Söhne's icon face (Mirage's Icon.tsx)
const icon = (glyph) => `<i class="icon" aria-hidden="true">${glyph}</i>`;

const PANEL_NAME = { eden: 'Paradise, left wing', garden: 'The garden, centre panel', hell: 'Hell, right wing' };
const SOUND_NOTE = {
  off: 'No sound.',
  nature: 'Birds, water, wind and fire where you look.',
  period: 'Lute, recorder and viol, about 1500, with the nature sounds.',
};
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
    fetch(`${import.meta.env.BASE_URL}data/strokes/stats.json`).then((r) => (r.ok ? r.json() : null)).then((s) => { this.stats = s; }).catch(() => {});
  }

  build() {
    const r = this.root;
    // markers
    this.markerLayer = el('div', { class: 'markers' });
    this.markers = this.pois.map((p) => {
      const b = el('button', { class: 'poi', 'aria-label': `Story: ${p.title}` }, `<span class="lz tag">${p.title}</span>`);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.openStory(p); });
      this.markerLayer.append(b);
      return { p, b, shown: false };
    });
    // story drawer
    this.story = el('aside', { class: 'story', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'story-title', 'aria-hidden': 'true' });
    this.story.innerHTML = `
      <header><p class="where"></p><button class="lz close" type="button" title="Close (Esc)">Close</button></header>
      <h2 id="story-title"></h2>
      <div class="body" tabindex="0"></div>`;
    this.story.querySelector('.close').addEventListener('click', () => this.closeStory());

    // navbar: breadcrumbs on the left; the painting's buttons and the menu on the right
    this.crumbs = el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumbs' }, `<ol>
      <li><a class="lz" href="${MIRAGE_URL}"><span>Mirage</span></a></li>
      <li><a class="lz" href="${import.meta.env.BASE_URL}" aria-current="page"><span>The Garden of Earthly Delights</span></a></li></ol>`);
    this.bar = el('nav', { class: 'bar', 'aria-label': 'Painting' });
    const controls = el('div', { class: 'controls', role: 'toolbar', 'aria-label': 'Painting controls' });
    const lz = (html, fn, attrs = {}) => {
      const b = el('button', { class: 'lz', type: 'button', ...attrs }, html);
      b.addEventListener('click', fn);
      return b;
    };
    this.wingsBtn = lz('Exterior', () => this.hooks.onWings?.(), { 'aria-pressed': 'false', title: 'Close the wings' });
    this.strokesBtn = lz('Strokes', () => this.togglePop('strokes'), { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    this.soundBtn = lz('Sound', () => this.togglePop('sound'), { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    controls.append(this.wingsBtn, this.strokesBtn, this.soundBtn);
    this.menuBtn = lz(icon('☰'), () => this.togglePop('menu'), { class: 'lz square', 'aria-label': 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    this.bar.append(controls, this.menuBtn);

    // zoom
    this.zoom = el('div', { class: 'zoom', role: 'toolbar', 'aria-label': 'Zoom' });
    this.zoom.append(
      lz('−', () => this.camera.zoomAt(1 / 1.8, this.camera.w / 2, this.camera.h / 2), { class: 'lz square', 'aria-label': 'Zoom out', title: 'Zoom out (-)' }),
      lz('+', () => this.camera.zoomAt(1.8, this.camera.w / 2, this.camera.h / 2), { class: 'lz square', 'aria-label': 'Zoom in', title: 'Zoom in (+)' }),
      lz('Whole painting', () => this.camera.flyTo(WORLD_W / 2, WORLD_H / 2, this.camera.fitScale), { title: 'Whole painting (0)' }),
    );

    // menu: the Mirage index, then how the painting shows
    this.menu = el('div', { class: 'panel', role: 'menu', 'aria-label': 'Menu', hidden: '' });
    this.menu.innerHTML = `<a class="lz" role="menuitem" href="${MIRAGE_URL}">Mirage</a>
      <div class="sep" role="separator"></div>
      <button class="lz out" type="button" role="menuitemcheckbox" data-k="stories"><span>Story markers</span><span class="state"></span></button>
      <button class="lz out" type="button" role="menuitemcheckbox" data-k="motion"><span>Living painting</span><span class="state"></span></button>
      <button class="lz out" type="button" role="menuitemcheckbox" data-k="age"><span>Varnish and cracks</span><span class="state"></span></button>
      <button class="lz out" type="button" role="menuitemcheckbox" data-k="full"><span>Full screen</span><span class="state"></span></button>`;
    this.item = Object.fromEntries([...this.menu.querySelectorAll('[data-k]')].map((b) => [b.dataset.k, b]));
    this.item.stories.addEventListener('click', () => this.setStories(!this.storiesOn));
    this.item.motion.addEventListener('click', () => this.setMotion(this.post.life < 0.5));
    this.item.age.addEventListener('click', () => this.setAge(this.post.age < 0.5));
    this.item.full.addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this.check('full', !!document.fullscreenElement));
    this.menu.addEventListener('keydown', (e) => this.listKeys(e, '[role^="menuitem"]'));
    // the post pass may start still (prefers-reduced-motion)
    for (const [k, on] of [['stories', true], ['motion', this.post.life > 0.5], ['age', this.post.age > 0.5], ['full', false]]) this.check(k, on);

    // sound panel
    this.soundPop = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'Sound', hidden: '' });
    this.soundPop.innerHTML = `<div role="radiogroup" aria-label="Sound">
        <button class="lz" type="button" role="radio" data-mode="off">Off</button>
        <button class="lz" type="button" role="radio" data-mode="nature">Nature</button>
        <button class="lz" type="button" role="radio" data-mode="period">Period music</button>
      </div><p class="note"></p>`;
    for (const o of this.soundPop.querySelectorAll('[role="radio"]')) o.addEventListener('click', () => this.chooseSound(o.dataset.mode));
    this.soundPop.addEventListener('keydown', (e) => this.listKeys(e, '[role="radio"]'));
    // strokes panel
    this.strokesPop = el('div', { class: 'panel strokes', role: 'dialog', 'aria-label': 'Brush strokes', hidden: '' });
    this.strokesPop.innerHTML = `<p class="big"><b data-k="total">…</b>strokes paint this triptych</p>
      <dl class="stats">
        <dt>Whole painting</dt><dd data-k="base">…</dd>
        <dt>Deep detail</dt><dd data-k="deep">…</dd>
        <dt>Closed shutters</dt><dd data-k="ext">…</dd>
        <dt>Behind this view</dt><dd data-k="view">…</dd>
        <dt>Painted this visit</dt><dd data-k="session">…</dd>
        <dt>Screen pixels</dt><dd data-k="px">…</dd>
      </dl>
      <button class="lz" type="button" aria-pressed="false">Show each stroke in its own colour</button>
      <div class="sep" role="separator"></div>
      <a class="lz out" href="${SOURCE_URL}" target="_blank" rel="noopener"><span>Source on GitHub, MIT licence</span>${icon('↗')}</a>`;
    this.strokeSwitch = this.strokesPop.querySelector('[aria-pressed]');
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

    r.append(this.markerLayer, this.mini, this.zoom, this.story, this.crumbs, this.bar, this.soundPop, this.strokesPop, this.menu);
    this.setSoundUI();
    // panels and the drawer start under the navbar, which is taller where its buttons wrap; the
    // framed painting rests in the screen under it, inside the margins, above a band as tall as
    // the navbar for the zoom buttons (as Mirage's painting box sits under its navbar)
    const layout = () => {
      const top = Math.max(this.crumbs.offsetHeight, this.bar.offsetHeight);
      const cs = getComputedStyle(document.documentElement);
      const margin = parseFloat(cs.getPropertyValue('--margin')), band = parseFloat(cs.getPropertyValue('--nav-h'));
      document.documentElement.style.setProperty('--nav-bottom', `${top}px`);
      this.camera.setBox({ x0: margin, y0: top, x1: window.innerWidth - margin, y1: window.innerHeight - band });
    };
    const navs = new ResizeObserver(layout);
    navs.observe(this.crumbs);
    navs.observe(this.bar);
    window.addEventListener('resize', layout);
    layout();
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.openPop) { const b = this.trigger(this.openPop); this.togglePop(this.openPop); b.focus(); } else this.closeStory();
    });
    window.addEventListener('pointerdown', (e) => {
      if (this.openPop && !e.target.closest('.panel') && !e.target.closest('.bar')) { this.togglePop(this.openPop); this.dismissed = performance.now(); }
    });
  }

  // a menu toggle: its state as a muted value, as in Mirage's information lists
  check(k, on) {
    this.item[k].setAttribute('aria-checked', String(on));
    this.item[k].querySelector('.state').textContent = on ? 'On' : 'Off';
  }

  // arrow keys move between the items of an open list (Menu.tsx, usePopover.ts)
  listKeys(e, selector) {
    const items = [...e.currentTarget.querySelectorAll(selector)];
    const i = items.indexOf(document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = i < 0 ? 0 : Math.min(items.length - 1, i + 1);
    else if (e.key === 'ArrowUp') next = i < 0 ? items.length - 1 : Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) { e.preventDefault(); items[next].focus(); }
  }

  setVisible(on) {
    this.enabled = on;
    for (const n of [this.bar, this.zoom, this.mini, this.markerLayer]) n.style.display = on ? '' : 'none';
    if (on && !this.linkChecked) {
      this.linkChecked = true;
      const id = new URLSearchParams(location.hash.slice(1)).get('story');
      const p = id && this.byId.get(id);
      if (p) setTimeout(() => this.openStory(p), 400);
    }
  }

  // ---------- panels ----------
  trigger(name) { return { sound: this.soundBtn, strokes: this.strokesBtn, menu: this.menuBtn }[name]; }

  togglePop(name) {
    const pops = { sound: this.soundPop, strokes: this.strokesPop, menu: this.menu };
    for (const [k, pop] of Object.entries(pops)) {
      const open = k === name && this.openPop !== name;
      pop.hidden = !open;
      const b = this.trigger(k);
      b.setAttribute('aria-expanded', String(open));
      b.dataset.state = open ? 'open' : 'closed';
    }
    this.openPop = this.openPop === name ? null : name;
    if (this.openPop === 'strokes') this.updateStats(true);
    if (this.openPop === 'menu') this.menu.querySelector('[role^="menuitem"]').focus();
  }

  chooseSound(mode) {
    if (mode === 'off') { this.soundOn = false; this.hooks.onSound?.(false); }
    else { this.soundMode = mode; this.soundOn = true; this.hooks.onSoundMode?.(mode); this.hooks.onSound?.(true); }
    this.setSoundUI();
  }
  setSound(on) { this.soundOn = on; this.hooks.onSound?.(on); this.setSoundUI(); }
  setSoundUI() {
    const current = this.soundOn ? this.soundMode : 'off';
    for (const o of this.soundPop.querySelectorAll('[role="radio"]')) o.setAttribute('aria-checked', String(o.dataset.mode === current));
    this.soundPop.querySelector('.note').textContent = SOUND_NOTE[current];
    // on, the lozenge is filled, as Mirage's Sound button
    this.soundBtn.toggleAttribute('data-on', this.soundOn);
    this.soundBtn.setAttribute('aria-label', `Sound: ${{ off: 'off', nature: 'nature', period: 'period music' }[current]}`);
  }

  setStrokeView(on) {
    this.strokeView = on;
    this.strokeSwitch.setAttribute('aria-pressed', String(on));
    this.strokesBtn.toggleAttribute('data-on', on);
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

  // The screen the drawer leaves to the painting: its columns and a margin on each side, or on
  // tablets and phones the sheet at the foot.
  drawerInset() {
    if (!this.current) return { x: 0, y: 0 };
    const margin = parseFloat(getComputedStyle(this.story).right) || 0;
    if (window.innerWidth <= 768) return { x: 0, y: this.story.offsetHeight + margin };
    return { x: this.story.offsetWidth + 2 * margin, y: 0 };
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
    this.check('stories', on);
    this.markerLayer.classList.toggle('hidden', !on);
  }
  setMotion(on) {
    this.post.life = on ? 1 : 0;
    this.check('motion', on);
    this.hooks.onMotion?.(on);
  }
  setAge(on) {
    this.post.age = on ? 1 : 0;
    this.check('age', on);
  }
  setClosed(closed) {
    this.closed = closed;
    this.wingsBtn.title = closed ? 'Open the wings' : 'Close the wings';
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
    if (!this.enabled || this.closed || !this.storiesOn || !this.camera.inOpening(sx, sy)) return false;
    // the tap that closed a panel only closes it
    if (performance.now() - (this.dismissed || 0) < 600) return false;
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
    const O = c.opening();
    for (const m of this.markers) {
      const [sx, sy] = c.worldToScreen(m.p.x, m.p.y);
      const rpx = m.p.r * c.scale;
      // quiet: only once you are close enough for the story to be legible, gone when inside it,
      // and only inside the frame's opening
      const show = this.storiesOn && rpx > 70 && rpx < minDim * 0.8 && sx > O.x0 + 6 && sy > O.y0 + 6 && sx < O.x1 - 6 && sy < O.y1 - 6;
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
