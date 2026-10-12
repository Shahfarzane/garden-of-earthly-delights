// Shared DSP toolkit: seeded randomness, shared noise buffers, one-shot
// synthesis primitives (tones, noise bursts, plucks, clangs, vowels) and the
// Voice base class that every bed and positional voice builds on.

export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
  // mulberry32
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  // 0-centred, roughly gaussian
  gauss() { return (this.next() + this.next() + this.next() - 1.5) * 2; }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const dB = (g) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// --- Shared per-context resources -----------------------------------------

const sharedByCtx = new WeakMap();

// Noise buffers are generated once per context and shared by every voice.
export function sharedResources(ctx) {
  let s = sharedByCtx.get(ctx);
  if (s) return s;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2.5);
  const rng = new Rng(0xb05c4);
  const white = ctx.createBuffer(1, len, sr);
  const pink = ctx.createBuffer(1, len, sr);
  const brown = ctx.createBuffer(1, len, sr);
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  // Paul Kellet's pink filter; leaky integrator for brown.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < len; i++) {
    const x = rng.next() * 2 - 1;
    w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02;
    b[i] = br * 3.5;
  }
  s = { white, pink, brown, cache: new Map() };
  sharedByCtx.set(ctx, s);
  return s;
}

// Looping noise source with a random start offset so voices decorrelate.
export function noiseSource(ctx, kind, rng, rate = 1, when = ctx.currentTime) {
  const buf = sharedResources(ctx)[kind];
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(Math.max(when, ctx.currentTime), rng ? rng.range(0, buf.duration) : 0);
  return src;
}

export function filter(ctx, type, f, Q = 1, gain = 0) {
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  fl.Q.value = Q;
  if (gain) fl.gain.value = gain;
  return fl;
}

export function gainNode(ctx, g = 1) {
  const n = ctx.createGain();
  n.gain.value = g;
  return n;
}

// Low-frequency oscillator wired into an AudioParam: param = base + depth*sin.
export function lfo(ctx, param, rate, depth, type = 'sine', phase = 0) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = rate;
  const g = gainNode(ctx, depth);
  osc.connect(g).connect(param);
  osc.start(ctx.currentTime + phase);
  return osc;
}

// --- One-shot events --------------------------------------------------------

// Linear attack, optional hold, linear release. Returns the end time.
export function envelope(param, t0, peak, a, dur, r) {
  param.value = 0; // silent until t0 (a GainNode defaults to 1)
  a = Math.min(a, dur * 0.5);
  r = Math.min(r, dur - a);
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + a);
  if (dur - a - r > 0) param.setValueAtTime(peak, t0 + dur - r);
  param.linearRampToValueAtTime(0, t0 + dur);
  return t0 + dur;
}

// Percussive: instant-ish attack then exponential decay (setTarget).
export function decayEnv(param, t0, peak, a, tau, dur) {
  param.value = 0;
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + a);
  param.setTargetAtTime(0, t0 + a, tau);
  param.setValueAtTime(0, t0 + dur);
}

/**
 * Oscillator tone with amplitude envelope and optional pitch glide/filter.
 * o: { t0, dur, f, f1, type, gain, a, r, detune, filter:{type,f,Q,f1}, vib:{rate,depth} }
 */
export function tone(ctx, dest, o) {
  const { t0, dur, f, type = 'sine', gain = 0.1 } = o;
  const a = o.a ?? 0.01, r = o.r ?? Math.min(0.08, dur * 0.5);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (o.f1 && o.f1 !== f) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.glide ?? dur));
  if (o.detune) osc.detune.value = o.detune;
  let vibOsc = null;
  if (o.vib) {
    vibOsc = ctx.createOscillator();
    vibOsc.frequency.value = o.vib.rate;
    const vg = gainNode(ctx, o.vib.depth);
    vibOsc.connect(vg).connect(osc.detune);
    vibOsc.start(t0);
    vibOsc.stop(t0 + dur + 0.05);
  }
  const g = ctx.createGain();
  envelope(g.gain, t0, gain, a, dur, r);
  let head = osc;
  if (o.filter) {
    const fl = filter(ctx, o.filter.type, o.filter.f, o.filter.Q ?? 1);
    if (o.filter.f1) {
      fl.frequency.setValueAtTime(o.filter.f, t0);
      fl.frequency.exponentialRampToValueAtTime(o.filter.f1, t0 + dur);
    }
    head.connect(fl);
    head = fl;
  }
  head.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
  return osc;
}

/**
 * Filtered noise burst. o: { t0, dur, kind, filter:{type,f,Q,f1}, gain, a, tau, rate }
 * With tau the envelope is percussive (exp decay), otherwise linear a/r.
 */
export function burst(ctx, dest, rng, o) {
  const { t0, dur, kind = 'white', gain = 0.1 } = o;
  const src = noiseSource(ctx, kind, rng, o.rate ?? 1, t0 - 0.01);
  const g = ctx.createGain();
  if (o.tau != null) decayEnv(g.gain, t0, gain, o.a ?? 0.003, o.tau, dur);
  else envelope(g.gain, t0, gain, o.a ?? 0.01, dur, o.r ?? Math.min(0.1, dur * 0.5));
  let head = src;
  if (o.filter) {
    const fl = filter(ctx, o.filter.type, o.filter.f, o.filter.Q ?? 1);
    if (o.filter.f1) {
      fl.frequency.setValueAtTime(o.filter.f, t0);
      fl.frequency.exponentialRampToValueAtTime(o.filter.f1, t0 + dur);
    }
    head.connect(fl);
    head = fl;
  }
  head.connect(g).connect(dest);
  src.stop(t0 + dur + 0.05);
  return src;
}

/**
 * Plucked string: bright sawtooth through a lowpass whose cutoff collapses
 * quickly, with an exponential amplitude decay. One oscillator + one filter
 * per note, far cheaper than a delay-line string and plausible for lute/harp.
 */
export function pluck(ctx, dest, o) {
  const { t0, f, gain = 0.15, dur = 1.5, bright = 7 } = o;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sawtooth';
  osc.frequency.value = f;
  if (o.detune) osc.detune.value = o.detune;
  const lp = filter(ctx, 'lowpass', f * bright, 0.7);
  lp.frequency.setValueAtTime(Math.min(f * bright, 12000), t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.2, 80), t0 + dur * 0.6);
  const g = ctx.createGain();
  decayEnv(g.gain, t0, gain, 0.003, dur * 0.28, dur);
  osc.connect(lp).connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  return osc;
}

export const METAL_RATIOS = [1, 1.47, 2.09, 2.56, 3.01, 4.17];
export const BELL_RATIOS = [0.5, 1, 1.183, 1.506, 2.0, 2.514, 3.011];

/** Inharmonic partial cluster: bells, anvils, clanks. */
export function clang(ctx, dest, o) {
  const { t0, f, gain = 0.1, dur = 1.0, ratios = METAL_RATIOS } = o;
  const g = ctx.createGain();
  g.gain.value = 1;
  g.connect(dest);
  ratios.forEach((r, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * r * (1 + (o.spread ?? 0) * (i - ratios.length / 2) * 0.001);
    const pg = ctx.createGain();
    // higher partials die faster
    const tau = (dur * 0.3) / (1 + i * 0.6);
    decayEnv(pg.gain, t0, gain / (1 + i * 0.7), 0.002, tau, dur);
    osc.connect(pg).connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  });
  if (o.strike) {
    burst(ctx, g, o.rng, { t0, dur: 0.06, tau: 0.012, gain: gain * 0.8, filter: { type: 'bandpass', f: f * 4, Q: 1 } });
  }
  return g;
}

/** Drum hit: pitched sine thump plus a short noise transient. */
export function drum(ctx, dest, rng, o) {
  const { t0, f = 90, gain = 0.3, dur = 0.35 } = o;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f * 2.2, t0);
  osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.04);
  const g = ctx.createGain();
  decayEnv(g.gain, t0, gain, 0.002, dur * 0.3, dur);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  burst(ctx, dest, rng, { t0, dur: 0.08, tau: 0.02, gain: gain * (o.snap ?? 0.4), filter: { type: 'bandpass', f: o.snapF ?? 1800, Q: 0.8 } });
}

// --- Vowels / formants -------------------------------------------------------

// F1..F3 centre frequencies (Hz) and relative gains for a generic adult voice.
export const VOWELS = {
  a: { f: [800, 1150, 2900], g: [1, 0.5, 0.25] },
  e: { f: [400, 1700, 2600], g: [1, 0.35, 0.2] },
  i: { f: [300, 2000, 2800], g: [1, 0.25, 0.2] },
  o: { f: [450, 800, 2830], g: [1, 0.6, 0.12] },
  u: { f: [325, 700, 2530], g: [1, 0.4, 0.08] },
  m: { f: [250, 1000, 2500], g: [1, 0.1, 0.05] },
};

/**
 * Three parallel bandpass "formants". Returns { input, output, setVowel(t, v, glide) }.
 * Feed it sawtooths (voices) or noise (whispers, murmur).
 */
export function formantBank(ctx, vowel = 'a', Q = 9) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const bands = [0, 1, 2].map(() => {
    const bp = filter(ctx, 'bandpass', 500, Q);
    const g = gainNode(ctx, 1);
    input.connect(bp).connect(g).connect(output);
    return { bp, g };
  });
  function setVowel(t, v, glide = 0.08) {
    const vw = VOWELS[v] || VOWELS.a;
    bands.forEach((b, i) => {
      b.bp.frequency.setTargetAtTime(vw.f[i], t, glide / 3);
      b.g.gain.setTargetAtTime(vw.g[i], t, glide / 3);
    });
  }
  setVowel(ctx.currentTime, vowel, 0.001);
  return { input, output, setVowel, bands };
}

/**
 * A sung/spoken vowel: detuned sawtooths through a formant bank.
 * o: { t0, dur, f, f1, vowels:[['a',0],['o',0.5]] (vowel, fraction of dur), gain, vib, a, r }
 */
export function vowelNote(ctx, dest, o) {
  const { t0, dur, f, gain = 0.1 } = o;
  const fb = formantBank(ctx, (o.vowels && o.vowels[0][0]) || 'a');
  for (const [v, frac] of o.vowels || []) fb.setVowel(t0 + dur * frac, v, 0.12);
  const voices = o.voices ?? 2;
  for (let i = 0; i < voices; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
    osc.detune.value = (i - (voices - 1) / 2) * (o.detune ?? 9);
    if (o.vib) {
      const v = ctx.createOscillator();
      v.frequency.value = o.vib.rate * (1 + i * 0.07);
      const vg = gainNode(ctx, o.vib.depth);
      v.connect(vg).connect(osc.detune);
      v.start(t0); v.stop(t0 + dur + 0.05);
    }
    osc.connect(fb.input);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  const g = ctx.createGain();
  envelope(g.gain, t0, gain, o.a ?? 0.06, dur, o.r ?? Math.min(0.15, dur * 0.4));
  fb.output.connect(g).connect(dest);
  return g;
}

// --- Voice base class --------------------------------------------------------

/**
 * A Voice owns an output GainNode, a list of continuous sources to stop on
 * dispose, and "patterns": generators that schedule one-shot events ahead of
 * the clock. schedule(until) advances every pattern up to `until`.
 */
export class Voice {
  constructor(ctx, seed = 1) {
    this.ctx = ctx;
    this.rng = new Rng(seed);
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.sources = [];
    this.patterns = [];
    this.disposed = false;
  }
  keep(node) { this.sources.push(node); return node; }
  // fn(t) schedules one event at time t and returns seconds until the next.
  pattern(delay, fn) { this.patterns.push({ t: this.ctx.currentTime + delay, fn }); }
  schedule(until) {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    for (const p of this.patterns) {
      // after a stall (hidden tab) skip ahead instead of firing a burst of catch-up events
      if (p.t < now - 0.3) p.t = now + this.rng.range(0.02, 0.3);
      let guard = 0;
      while (p.t < until && guard++ < 64) {
        const dt = p.fn(p.t);
        p.t += Math.max(0.015, dt || 0.5);
      }
    }
  }
  noise(kind, fl, g = 0.1, rate = 1) {
    const src = this.keep(noiseSource(this.ctx, kind, this.rng, rate));
    const gn = gainNode(this.ctx, g);
    if (fl) {
      const f = filter(this.ctx, fl.type, fl.f, fl.Q ?? 1);
      src.connect(f).connect(gn);
      gn.filter = f;
    } else src.connect(gn);
    gn.connect(this.out);
    gn.src = src;
    return gn;
  }
  osc(type, f, g = 0.1, detune = 0) {
    const o = this.keep(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.start();
    const gn = gainNode(this.ctx, g);
    o.connect(gn);
    gn.osc = o;
    return gn;
  }
  lfo(param, rate, depth, type) { return this.keep(lfo(this.ctx, param, rate, depth, type)); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.sources) { try { n.stop(); } catch { /* already stopped */ } }
    try { this.out.disconnect(); } catch { /* detached */ }
  }
}

// --- Reverb impulse responses ----------------------------------------------

/**
 * Synthesized stereo impulse response: exponentially decaying noise whose
 * spectrum darkens over time (one-pole lowpass with a closing coefficient),
 * with a few early reflections and a short predelay.
 * o: { seconds, decay (dB/s-ish factor), lowpassStart, lowpassEnd, predelay, early, seed }
 */
export function makeImpulse(ctx, o) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * o.seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const rng = new Rng(o.seed ?? 7);
  const pre = Math.floor(sr * (o.predelay ?? 0.01));
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const frac = t / o.seconds;
      // lowpass coefficient slides from bright to dark across the tail
      const cutoff = o.lowpassStart + (o.lowpassEnd - o.lowpassStart) * frac;
      const k = Math.exp((-2 * Math.PI * cutoff) / sr);
      const x = rng.next() * 2 - 1;
      lp = x * (1 - k) + lp * k;
      d[i] = lp * Math.exp(-t * o.decay) * (1 - 0.3 * frac);
    }
    // sparse early reflections
    for (let e = 0; e < (o.early ?? 6); e++) {
      const at = pre + Math.floor(sr * rng.range(0.004, 0.06));
      if (at < n) d[at] += rng.range(0.2, 0.6) * (rng.chance(0.5) ? 1 : -1);
    }
    d[pre] += 0.1;
  }
  // normalise to unity peak-ish energy so send gains mean the same thing everywhere
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i])); }
  const norm = 0.5 / (peak || 1);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= norm; }
  return buf;
}
