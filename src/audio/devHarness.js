// Dev harness for dev/audio.html: a map of the triptych with the sound zones,
// a draggable virtual view centre, zoom slider, voice solo list, cue buttons,
// focus select and the offline render test.

import { Soundscape } from './soundscape.js';
import { VOICE_NAMES, VOICE_PANEL } from './voices.js';
import { runOfflineTest } from './offlineTest.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids) n.append(k);
  return n;
};

const PANEL_COLOR = { eden: '#5fae6a', garden: '#d8b74a', hell: '#c75b4a' };
const VIEW_W = 1280, VIEW_H = 800;
const SCALE_MIN = 0.006, SCALE_MAX = 2.0;

async function main() {
  const scene = await (await fetch(`${import.meta.env.BASE_URL}data/scene.json`)).json();
  const sc = new Soundscape(scene);
  window.__soundscape = sc;

  const view = { cx: 78000, cy: 44000, scale: 0.006, viewW: VIEW_W, viewH: VIEW_H, time: 0 };
  const W = scene.world.w, H = scene.world.h;
  const canvas = $('#map');
  const k = canvas.width / W;
  canvas.height = Math.round(H * k);
  const g2 = canvas.getContext('2d');

  function draw() {
    g2.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of scene.panels) {
      g2.fillStyle = PANEL_COLOR[p.id] + '22';
      g2.fillRect(p.x0 * k, p.y0 * k, (p.x1 - p.x0) * k, (p.y1 - p.y0) * k);
      g2.strokeStyle = PANEL_COLOR[p.id];
      g2.strokeRect(p.x0 * k, p.y0 * k, (p.x1 - p.x0) * k, (p.y1 - p.y0) * k);
    }
    const active = new Set(sc.activeVoices.map((a) => a.id));
    for (const z of sc.zones) {
      g2.beginPath();
      g2.arc(z.x * k, z.y * k, Math.max(2, z.r * k), 0, Math.PI * 2);
      const on = active.has(z.id);
      g2.fillStyle = on ? PANEL_COLOR[z.panel] + '66' : (z.source === 'poi' ? '#ffffff10' : PANEL_COLOR[z.panel] + '18');
      g2.fill();
      g2.strokeStyle = on ? '#fff' : (z.source === 'poi' ? '#ffffff55' : PANEL_COLOR[z.panel] + '88');
      g2.lineWidth = on ? 1.5 : 0.6;
      g2.stroke();
    }
    g2.lineWidth = 1;
    // view rectangle
    const vw = view.viewW / view.scale, vh = view.viewH / view.scale;
    g2.strokeStyle = '#7fd3ff';
    g2.lineWidth = 1.5;
    g2.strokeRect((view.cx - vw / 2) * k, (view.cy - vh / 2) * k, vw * k, vh * k);
    g2.fillStyle = '#7fd3ff';
    g2.beginPath(); g2.arc(view.cx * k, view.cy * k, 3, 0, Math.PI * 2); g2.fill();
    g2.lineWidth = 1;
  }

  let dragging = false;
  const setCentre = (ev) => {
    const r = canvas.getBoundingClientRect();
    view.cx = ((ev.clientX - r.left) / r.width) * W;
    view.cy = ((ev.clientY - r.top) / r.height) * H;
  };
  canvas.addEventListener('pointerdown', (e) => { dragging = true; setCentre(e); });
  canvas.addEventListener('pointermove', (e) => { if (dragging) setCentre(e); });
  window.addEventListener('pointerup', () => { dragging = false; });

  const zoom = $('#zoom');
  const zoomToScale = (v) => Math.exp(Math.log(SCALE_MIN) + (Math.log(SCALE_MAX) - Math.log(SCALE_MIN)) * v);
  zoom.addEventListener('input', () => { view.scale = zoomToScale(+zoom.value); $('#zoomVal').textContent = view.scale.toFixed(4); });
  view.scale = zoomToScale(+zoom.value);
  $('#zoomVal').textContent = view.scale.toFixed(4);

  $('#start').addEventListener('click', async () => { await sc.start(); $('#start').textContent = 'Audio running'; });
  $('#mute').addEventListener('change', (e) => sc.setMuted(e.target.checked));
  $('#mode').addEventListener('change', (e) => sc.setMode(e.target.value));
  sc.setMode($('#mode').value);
  $('#volume').addEventListener('input', (e) => sc.setVolume(+e.target.value));
  for (const name of ['open', 'poi', 'tour', 'thunder', 'close']) {
    $('#cues').append(el('button', { onclick: () => sc.cue(name) }, name));
  }
  const focusSel = $('#focus');
  focusSel.append(el('option', { value: '' }, '(no focus)'));
  for (const p of [...scene.pois].sort((a, b) => a.title.localeCompare(b.title))) {
    focusSel.append(el('option', { value: p.id }, `${p.title} [${p.panel}]`));
  }
  focusSel.addEventListener('change', () => {
    sc.focus(focusSel.value || null);
    const poi = scene.pois.find((p) => p.id === focusSel.value);
    if (poi && $('#jump').checked) { view.cx = poi.x; view.cy = poi.y; }
  });

  // voice list with solo buttons
  const list = $('#voices');
  let soloed = null;
  const soloButtons = new Map();
  for (const name of VOICE_NAMES) {
    const btn = el('button', { class: 'solo', onclick: () => {
      soloed = soloed === name ? null : name;
      sc.solo(soloed);
      for (const [n, b] of soloButtons) b.classList.toggle('on', n === soloed);
    } }, 'solo');
    soloButtons.set(name, btn);
    const count = sc.zones.filter((z) => z.type === name).length;
    list.append(el('li', { style: `border-left: 3px solid ${PANEL_COLOR[VOICE_PANEL[name]]}` }, btn, el('span', { class: 'name' }, name), el('span', { class: 'dim' }, ` ${count} zones`)));
  }

  function renderActive() {
    const act = sc.activeVoices.sort((a, b) => b.gain - a.gain);
    $('#active').replaceChildren(...act.map((a) => el('li', {},
      el('span', { class: 'name' }, a.type), ` ${a.title ? a.title : a.id} `,
      el('span', { class: 'dim' }, `g ${a.gain.toFixed(2)} pan ${a.pan.toFixed(2)}`))));
    const bw = sc.bedWeights;
    $('#beds').textContent = `mode ${sc.mode} | beds eden ${bw.eden.toFixed(2)} garden ${bw.garden.toFixed(2)} hell ${bw.hell.toFixed(2)}  | voices ${act.length}  | ctx ${sc.context ? sc.context.state : 'none'}`;
  }

  let frames = 0;
  function loop(t) {
    view.time = t / 1000;
    sc.update(view);
    if (frames++ % 6 === 0) { draw(); renderActive(); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // --- offline test
  async function runTest() {
    const out = $('#testOut');
    out.replaceChildren(el('p', {}, 'Rendering...'));
    const table = el('table', {}, el('thead', {}, el('tr', {}, ...['kind', 'name', 'mode', 's', 'peak dBFS', 'RMS dBFS', 'raw peak', 'raw RMS', 'music gens', 'NaN', 'pass'].map((h) => el('th', {}, h)))));
    const body = el('tbody');
    table.append(body);
    out.replaceChildren(table);
    const rows = await runOfflineTest({
      onRow: (r) => body.append(el('tr', { class: r.pass ? 'pass' : 'fail' },
        el('td', {}, r.kind), el('td', {}, r.name), el('td', {}, r.mode), el('td', {}, String(r.seconds)), el('td', {}, String(r.peakDb)), el('td', {}, String(r.rmsDb)), el('td', {}, String(r.rawPeakDb)), el('td', {}, String(r.rawRmsDb)), el('td', {}, String(r.musicBuilt)), el('td', {}, String(r.nan)), el('td', {}, r.pass ? 'PASS' : 'FAIL'))),
    });
    const failed = rows.filter((r) => !r.pass);
    const summary = `offline test: ${rows.length - failed.length}/${rows.length} pass` + (failed.length ? ` FAILED: ${failed.map((r) => r.name).join(', ')}` : '');
    out.append(el('p', { id: 'testSummary', class: failed.length ? 'fail' : 'pass' }, summary));
    console.table(rows);
    console.log(summary);
    window.__audioTest = { rows, summary, done: true };
  }
  $('#runTest').addEventListener('click', runTest);
  if (new URLSearchParams(location.search).has('test')) runTest();
}

main().catch((e) => { console.error(e); document.body.append(el('pre', { class: 'fail' }, String(e.stack || e))); });
