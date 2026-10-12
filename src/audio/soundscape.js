// Soundscape: the public audio API for the app. Owns the AudioContext, the
// master chain, the three section beds and the pool of positional voices.

import { clamp, gainNode } from './dsp.js';
import { createMaster } from './master.js';
import { BEDS } from './beds.js';
import { createVoice, VOICE_PANEL } from './voices.js';
import { buildZones } from './zones.js';
import { playCue } from './cues.js';
import { MUSIC_BEDS } from './music.js';

const MAX_VOICES = 12;
const MAX_PER_TYPE = 2;
const NEAR_FACTOR = 2.5;      // build voices within this many view radii
const LOOKAHEAD = 0.5;        // seconds of events scheduled ahead of the clock
const FADE_TC = 0.2;          // time constant: ~0.6 s to settle
const MODE_TC = 0.45;         // mode switch crossfade: ~1.5 s to settle
const MODES = ['nature', 'period'];
const SCALE_OVERVIEW = 0.006;
const SCALE_CLOSE = 0.1;

// Period balance, measured in the live app: the consort sits about 10 dB above the
// ambience, and both modes play at a similar overall loudness.
const MUSIC_LEVEL = 1.7;    // consort gain at the overview; 0.65 of it when zoomed into a scene
const AMBIENCE_DUCK = 0.6;  // ambience level while period music plays

export class Soundscape {
  constructor(scene) {
    this.scene = scene;
    this.zones = buildZones(scene);
    this.zoneById = new Map(this.zones.map((z) => [z.id, z]));
    this.ctx = null;
    this.master = null;
    this.beds = {};          // panel -> { bed, fade, music, musicFade }
    this.active = new Map(); // zone id -> { zone, voice, fade, panner, gain, pan }
    this._mode = 'nature';
    this.slowFadeUntil = 0;
    this.focusId = null;
    this.soloType = null;
    this.muted = false;
    this.volume = 1;
    this.bedWeights = { eden: 0, garden: 0, hell: 0 };
    this.lastView = null;
  }

  get context() { return this.ctx; }

  async start() {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      this.ctx = ctx;
      this.master = createMaster(ctx);
      this.master.setVolume(this.volume);
      this.master.setMuted(this.muted);
      let seed = 101;
      for (const panel of Object.keys(BEDS)) {
        const bed = BEDS[panel](ctx, seed++);
        const fade = gainNode(ctx, 0);
        bed.out.connect(fade).connect(this.master.sections[panel].bus);
        const musicFade = gainNode(ctx, 0);
        musicFade.connect(this.master.sections[panel].bus);
        this.beds[panel] = { bed, fade, music: null, musicFade };
      }
      if (this._mode === 'period') this.buildMusic();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.lastView) this.update(this.lastView);
  }

  get mode() { return this._mode; }
  /** 'nature': ambience only. 'period': ambience plus consort music. Crossfades ~1.5 s. */
  setMode(mode) {
    if (!MODES.includes(mode) || mode === this._mode) return;
    this._mode = mode;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.slowFadeUntil = now + 1.5;
    if (mode === 'period') this.buildMusic();
    else {
      for (const b of Object.values(this.beds)) {
        const m = b.music;
        if (!m) continue;
        b.music = null;
        b.musicFade.gain.setTargetAtTime(0, now, MODE_TC);
        setTimeout(() => m.dispose(), 2000);
      }
    }
    // positional voices carry mode-specific parts: let them go and respawn on the next update
    for (const [id, a] of [...this.active]) this.release(id, a, MODE_TC, 2000);
  }

  buildMusic() {
    let seed = 301;
    for (const [panel, b] of Object.entries(this.beds)) {
      if (b.music) continue;
      b.music = MUSIC_BEDS[panel](this.ctx, seed++);
      b.music.out.connect(b.musicFade);
    }
  }

  setMuted(m) { this.muted = !!m; if (this.master) this.master.setMuted(this.muted); }
  setVolume(v) { this.volume = clamp(v, 0, 1); if (this.master) this.master.setVolume(this.volume); }
  focus(poiId) { this.focusId = poiId || null; }
  // Dev harness: play exactly one voice type, centred, beds off. null restores.
  solo(type) { this.soloType = type || null; }

  cue(name, gain = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || gain <= 0) return;
    playCue(name, this.ctx, this.master.sections.cue.bus, undefined, undefined, gain);
  }

  update(view) {
    this.lastView = view;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const { cx, cy, scale, viewW, viewH } = view;

    // 0 at the whole-painting overview, 1 once zoomed into a scene
    const z = clamp((Math.log(scale) - Math.log(SCALE_OVERVIEW)) / (Math.log(SCALE_CLOSE) - Math.log(SCALE_OVERVIEW)), 0, 1);
    const focusing = this.focusId != null;
    const tc = now < this.slowFadeUntil ? MODE_TC : FADE_TC;
    // In 'period' the consort leads: it plays well above the ambience, which ducks under it,
    // and it stays clearly present when zoomed into a scene.
    const period = this._mode === 'period';
    const duck = period ? AMBIENCE_DUCK : 1;
    let voiceMaster = (0.12 + 0.88 * Math.pow(z, 0.8)) * duck;
    let bedMaster = (1 - 0.5 * z) * (focusing ? 0.65 : 1) * duck;
    const musicMaster = MUSIC_LEVEL * (1 - 0.35 * z) * (focusing ? 0.7 : 1);

    // --- beds: crossfade by visible panel width plus where the centre sits
    const halfW = viewW / (2 * scale);
    const x0 = cx - halfW, x1 = cx + halfW;
    const weights = {};
    let sum = 0;
    for (const p of this.scene.panels) {
      const overlap = Math.max(0, Math.min(x1, p.x1) - Math.max(x0, p.x0)) / (x1 - x0);
      const dCentre = cx < p.x0 ? p.x0 - cx : cx > p.x1 ? cx - p.x1 : 0;
      const centre = Math.max(0, 1 - dCentre / 12000);
      weights[p.id] = overlap + 0.6 * centre;
      sum += weights[p.id];
    }
    for (const p of this.scene.panels) {
      const w = sum > 0 ? Math.sqrt(weights[p.id] / sum) : 0; // equal-power
      this.bedWeights[p.id] = w;
      const target = this.soloType ? 0 : w * bedMaster;
      const b = this.beds[p.id];
      b.fade.gain.setTargetAtTime(target, now, tc);
      if (b.music) b.musicFade.gain.setTargetAtTime(this.soloType ? 0 : w * musicMaster, now, tc);
    }

    // --- positional voices
    const viewR = 0.5 * Math.hypot(viewW, viewH) / scale;
    const wanted = [];
    if (this.soloType) {
      wanted.push({ zone: { id: `solo-${this.soloType}`, type: this.soloType, panel: VOICE_PANEL[this.soloType] || 'garden', x: cx, y: cy, r: 1 }, gain: 1, pan: 0 });
    } else {
      const focusZone = focusing ? this.zoneForPoi(this.focusId) : null;
      for (const zone of this.zones) {
        const d = Math.hypot(zone.x - cx, zone.y - cy);
        if (d > zone.r + NEAR_FACTOR * viewR && zone !== focusZone) continue;
        const rel = d / (zone.r + viewR);
        let g = rel < 1 ? zone.volume * Math.pow(1 - rel, 1.5) : 0;
        g *= voiceMaster;
        if (zone === focusZone) g = Math.max(g, 0.9);
        else if (focusing) g *= 0.7;
        if (g < 0.004) continue;
        const pan = clamp(((zone.x - cx) * scale) / (viewW * 0.6), -1, 1);
        wanted.push({ zone, gain: g, pan, pinned: zone === focusZone });
      }
      wanted.sort((a, b) => (b.pinned - a.pinned) || (b.gain - a.gain));
      // neighbouring zones often share a voice type; two instances of one type is plenty
      const perType = new Map();
      for (let i = 0; i < wanted.length;) {
        const n = perType.get(wanted[i].zone.type) || 0;
        if (n >= MAX_PER_TYPE && !wanted[i].pinned) wanted.splice(i, 1);
        else { perType.set(wanted[i].zone.type, n + 1); i++; }
      }
      wanted.length = Math.min(wanted.length, MAX_VOICES);
    }

    const keep = new Set();
    for (const w of wanted) {
      keep.add(w.zone.id);
      let a = this.active.get(w.zone.id);
      if (!a) a = this.spawn(w.zone);
      a.gain = w.gain; a.pan = w.pan;
      a.fade.gain.setTargetAtTime(w.gain, now, tc);
      a.panner.pan.setTargetAtTime(w.pan, now, 0.1);
    }
    for (const [id, a] of this.active) {
      if (!keep.has(id)) this.release(id, a);
    }

    // --- lookahead scheduling of every running pattern
    const until = now + LOOKAHEAD;
    for (const b of Object.values(this.beds)) { b.bed.schedule(until); if (b.music) b.music.schedule(until); }
    for (const a of this.active.values()) a.voice.schedule(until);
  }

  zoneForPoi(poiId) {
    return this.zoneById.get(`poi-${poiId}`) || this.zones.find((z) => z.poiId === poiId) || null;
  }

  spawn(zone) {
    const ctx = this.ctx;
    const voice = createVoice(zone.type, ctx, hashSeed(zone.id), { music: this._mode === 'period' });
    const fade = gainNode(ctx, 0);
    const panner = ctx.createStereoPanner();
    const bus = this.master.sections[zone.panel]?.bus || this.master.sections.garden.bus;
    voice.out.connect(fade).connect(panner).connect(bus);
    const a = { zone, voice, fade, panner, gain: 0, pan: 0, dying: false };
    this.active.set(zone.id, a);
    return a;
  }

  release(id, a, tc = FADE_TC, disposeMs = 900) {
    if (a.dying) return;
    a.dying = true;
    this.active.delete(id);
    a.fade.gain.setTargetAtTime(0, this.ctx.currentTime, tc);
    setTimeout(() => { a.voice.dispose(); try { a.panner.disconnect(); } catch { /* detached */ } }, disposeMs);
  }

  // Snapshot for the dev harness
  get activeVoices() {
    return [...this.active.values()].map((a) => ({ id: a.zone.id, type: a.zone.type, title: a.zone.poiTitle, gain: a.gain, pan: a.pan }));
  }
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
