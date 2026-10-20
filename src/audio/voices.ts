// Positional voices: one factory per voice type. Each returns a Voice whose
// `out` the Soundscape pans and mixes. Everything here is scheduled through
// Voice.pattern so the same code renders live or into an OfflineAudioContext.
// Factories take (ctx, seed, o): o.music is true in 'period' mode and enables
// the melodic/instrumental parts; in 'nature' mode those are never built.

import {
  Voice, tone, burst, pluck, clang, drum, vowelNote, formantBank, filter, gainNode,
  mtof, METAL_RATIOS, BELL_RATIOS,
} from './dsp.ts';
import { SPECIES, SONGBIRDS, addBirdChorus } from './birds.ts';
import { BUTTOCK_SONG } from './buttockSong.ts';
import { markMusic } from './music.ts';
import type { Vowel } from './dsp.ts';
import type { SpeciesName } from './birds.ts';
import type { PanelId } from '../scene.ts';

// Builds a positional voice; o.music adds the parts played in 'period' mode.
export type VoiceFactory = (ctx: BaseAudioContext, seed: number, o?: { music?: boolean }) => Voice;
export type VoiceType = keyof typeof VOICES;

const DORIAN_D = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77];

// --- shared building blocks ------------------------------------------------

function waterFlow(v: Voice, gain = 0.03, f = 2600, Q = 1.4) {
  const flow = v.noise('white', { type: 'bandpass', f, Q }, gain);
  v.lfo(flow.gain, 4.7, gain * 0.35);
  v.lfo(flow.gain, 7.9, gain * 0.25);
  return flow;
}

function bloops(v: Voice, gain = 0.02, gapMin = 0.2, gapMax = 0.9) {
  v.pattern(0.2, (t) => {
    const f = v.rng.range(700, 1600);
    tone(v.ctx, v.out, { t0: t, dur: v.rng.range(0.05, 0.1), f, f1: f * v.rng.range(1.6, 2.4), gain: gain * v.rng.range(0.5, 1) });
    return v.rng.range(gapMin, gapMax);
  });
}

function splashes(v: Voice, gain = 0.05, gapMin = 0.3, gapMax = 1.4) {
  v.pattern(0.1, (t) => {
    const dur = v.rng.range(0.12, 0.45);
    burst(v.ctx, v.out, v.rng, { t0: t, dur, kind: 'white', a: 0.015, r: dur * 0.6, gain: gain * v.rng.range(0.5, 1), filter: { type: 'bandpass', f: v.rng.range(1000, 3000), Q: 0.8, f1: v.rng.range(600, 1500) } });
    return v.rng.range(gapMin, gapMax);
  });
}

// "ha-ha-ha": a short descending staircase of open vowels
function laugh(v: Voice, dest: AudioNode, t0: number, gain: number): number {
  const n = v.rng.int(3, 6);
  const f0 = v.rng.range(260, 520);
  for (let i = 0; i < n; i++) {
    vowelNote(v.ctx, dest, { t0: t0 + i * 0.16, dur: 0.11, f: f0 * Math.pow(0.95, i), f1: f0 * Math.pow(0.95, i) * 0.9, vowels: [['a', 0]], gain, a: 0.02, r: 0.05 });
  }
  return n * 0.16;
}

function groan(v: Voice, dest: AudioNode, t0: number, gain: number): number {
  const f = v.rng.range(95, 190);
  const dur = v.rng.range(0.9, 2.2);
  vowelNote(v.ctx, dest, { t0, dur, f, f1: f * v.rng.range(0.7, 0.9), vowels: [['o', 0], ['u', 0.6]], gain, a: 0.25, r: 0.5, vib: { rate: 5, depth: 20 } });
  return dur;
}

function chainRattle(v: Voice, dest: AudioNode, t0: number, gain: number): number {
  const n = v.rng.int(3, 8);
  for (let i = 0; i < n; i++) {
    clang(v.ctx, dest, { t0: t0 + i * v.rng.range(0.03, 0.09), f: v.rng.range(1800, 3400), gain: gain * v.rng.range(0.4, 1), dur: 0.18, ratios: METAL_RATIOS.slice(0, 4) });
  }
  return n * 0.07;
}

// Wooden creak: resonant pink noise sweeping down, like strained timber.
function creak(v: Voice, dest: AudioNode, t0: number, gain: number): number {
  const dur = v.rng.range(0.4, 1.1);
  burst(v.ctx, dest, v.rng, { t0, dur, kind: 'pink', a: 0.08, r: dur * 0.5, gain, filter: { type: 'bandpass', f: v.rng.range(400, 700), Q: 11, f1: v.rng.range(180, 320) } });
  return dur;
}

// Continuous murmur: pink noise through a vowel bank whose vowel keeps changing.
function murmur(v: Voice, gain: number, vowels: Vowel[] = ['a', 'o', 'e', 'm', 'u']) {
  const fb = formantBank(v.ctx, 'a', 6);
  const src = v.noise('pink', { type: 'bandpass', f: 500, Q: 0.5 }, 1);
  src.disconnect();
  src.connect(fb.input);
  const g = gainNode(v.ctx, gain);
  fb.output.connect(g).connect(v.out);
  v.lfo(g.gain, 0.9, gain * 0.3);
  v.lfo(g.gain, 2.3, gain * 0.2);
  v.pattern(0.1, (t) => {
    fb.setVowel(t, v.rng.pick(vowels), 0.15);
    return v.rng.range(0.15, 0.5);
  });
  return g;
}

// --- Eden ---------------------------------------------------------------------

export const VOICES = {
  'fountain-owl': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    waterFlow(v, 0.06, 2400, 1.1);
    const fall = v.noise('pink', { type: 'bandpass', f: 900, Q: 0.6 }, 0.045);
    v.lfo(fall.gain, 0.4, 0.02);
    bloops(v, 0.04, 0.15, 0.6);
    v.pattern(1.5, (t) => SPECIES.owl(ctx, v.out, v.rng, t, 0.12) + v.rng.range(3.5, 9));
    return v;
  },
  'swans': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    const lap = v.noise('white', { type: 'lowpass', f: 1200, Q: 0.7 }, 0.03);
    v.lfo(lap.gain, 0.5, 0.015);
    v.lfo(lap.gain, 1.3, 0.008);
    v.pattern(0.5, (t) => SPECIES[v.rng.chance(0.55) ? 'swan' : 'duck'](ctx, v.out, v.rng, t, 0.08) + v.rng.range(1.5, 5));
    v.pattern(1.2, (t) => SPECIES.flap(ctx, v.out, v.rng, t, 0.03) + v.rng.range(3, 8));
    return v;
  },
  'meadow-beasts': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    const breeze = v.noise('pink', { type: 'bandpass', f: 700, Q: 0.5 }, 0.02);
    v.lfo(breeze.filter.frequency, 0.1, 250);
    // grazing: soft grass rustle
    v.pattern(0.2, (t) => {
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.18, kind: 'pink', a: 0.03, r: 0.08, gain: 0.03, filter: { type: 'bandpass', f: 2200, Q: 0.7 } });
      return v.rng.range(0.3, 1.1);
    });
    // low grunt / lowing
    v.pattern(1, (t) => {
      const f = v.rng.range(70, 110);
      vowelNote(ctx, v.out, { t0: t, dur: 0.7, f, f1: f * 0.85, vowels: [['o', 0], ['m', 0.5]], gain: 0.05, a: 0.1, r: 0.3 });
      return v.rng.range(3, 8);
    });
    // elephant trumpet, rare
    v.pattern(4, (t) => {
      const f = v.rng.range(240, 320);
      tone(ctx, v.out, { t0: t, dur: 0.9, f, f1: f * 1.9, type: 'sawtooth', gain: 0.07, a: 0.05, filter: { type: 'bandpass', f: 1300, Q: 1.8, f1: 2200 }, vib: { rate: 9, depth: 70 } });
      return v.rng.range(9, 22);
    });
    addBirdChorus(v, v.out, ['thrush', 'finch'], { gain: 0.03, gapMin: 2, gapMax: 6 });
    return v;
  },
  'frogs-reptiles': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    const pond = v.noise('brown', { type: 'lowpass', f: 400, Q: 0.6 }, 0.05);
    v.lfo(pond.gain, 0.3, 0.02);
    // croak: a pulse train of tiny low tones
    const croak = (t: number, f: number, gain: number) => {
      const n = v.rng.int(4, 8), step = v.rng.range(0.045, 0.07);
      for (let i = 0; i < n; i++) {
        tone(ctx, v.out, { t0: t + i * step, dur: step * 0.75, f, f1: f * 1.08, type: 'sawtooth', gain, a: 0.008, filter: { type: 'bandpass', f: f * 6, Q: 1.5 } });
      }
      return n * step;
    };
    for (let k = 0; k < 3; k++) {
      const f = [85, 120, 160][k];
      v.pattern(k * 0.4, (t) => croak(t, f * v.rng.range(0.93, 1.07), 0.05) + v.rng.range(0.9, 3.5));
    }
    // wet squelch / slither
    v.pattern(1, (t) => {
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.3, kind: 'pink', a: 0.03, r: 0.2, gain: 0.04, filter: { type: 'lowpass', f: 1400, Q: 3, f1: 300 } });
      return v.rng.range(1.5, 4);
    });
    return v;
  },
  'bird-flock': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    const wind = v.noise('pink', { type: 'bandpass', f: 1200, Q: 0.5 }, 0.02);
    v.lfo(wind.gain, 0.3, 0.01);
    for (let k = 0; k < 3; k++) v.pattern(k * 0.15, (t) => SPECIES.flap(ctx, v.out, v.rng, t, 0.025) + v.rng.range(0.1, 0.8));
    addBirdChorus(v, v.out, ['finch', 'robin', 'warbler', 'crow'], { gain: 0.03, gapMin: 0.15, gapMax: 0.9 });
    return v;
  },
  'beasts-fighting': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    v.pattern(0.3, (t) => {
      const f = v.rng.range(65, 115);
      const dur = v.rng.range(0.5, 1.2);
      tone(ctx, v.out, { t0: t, dur, f, f1: f * v.rng.range(0.8, 1.3), type: 'sawtooth', gain: 0.09, a: 0.08, filter: { type: 'bandpass', f: 420, Q: 1.4 }, vib: { rate: 26, depth: 120 } });
      return dur + v.rng.range(1, 4);
    });
    // snarl / snap
    v.pattern(1, (t) => {
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.25, kind: 'white', a: 0.01, r: 0.15, gain: 0.05, filter: { type: 'bandpass', f: 1600, Q: 1.2, f1: 700 } });
      return v.rng.range(1.5, 5);
    });
    // scuffle in the grass
    v.pattern(0.5, (t) => {
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.12, kind: 'pink', tau: 0.04, gain: 0.04, filter: { type: 'bandpass', f: 2000, Q: 0.8 } });
      return v.rng.range(0.2, 0.9);
    });
    addBirdChorus(v, v.out, ['crow', 'thrush'], { gain: 0.03, gapMin: 2, gapMax: 7 });
    return v;
  },
  'birds-eden': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    const breeze = v.noise('pink', { type: 'bandpass', f: 800, Q: 0.6 }, 0.02);
    v.lfo(breeze.filter.frequency, 0.08, 300);
    addBirdChorus(v, v.out, SONGBIRDS.concat(['cuckoo', 'hoopoe']), { gain: 0.09, gapMin: 0.6, gapMax: 3 });
    addBirdChorus(v, v.out, ['robin', 'finch'], { gain: 0.03, gapMin: 1.5, gapMax: 4, delay: 0.9 });
    return v;
  },
  'water-trickle': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    waterFlow(v, 0.08, 3000, 1.6);
    const low = v.noise('pink', { type: 'bandpass', f: 600, Q: 0.7 }, 0.04);
    v.lfo(low.gain, 0.35, 0.015);
    bloops(v, 0.05, 0.12, 0.5);
    return v;
  },

  // --- Garden -----------------------------------------------------------------

  'birds-garden': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    addBirdChorus(v, v.out, SONGBIRDS.concat(['hoopoe', 'woodpecker']), { gain: 0.05, gapMin: 0.4, gapMax: 2 });
    addBirdChorus(v, v.out, ['finch', 'robin', 'duck', 'cuckoo'], { gain: 0.035, gapMin: 0.8, gapMax: 3, delay: 0.5 });
    const breeze = v.noise('pink', { type: 'bandpass', f: 1000, Q: 0.5 }, 0.015);
    v.lfo(breeze.filter.frequency, 0.07, 350);
    return v;
  },
  'splash-pool': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    waterFlow(v, 0.025, 2000, 1);
    splashes(v, 0.06, 0.25, 1.1);
    v.pattern(0.8, (t) => laugh(v, v.out, t, 0.045) + v.rng.range(1.5, 5));
    murmur(v, 0.025, ['a', 'e', 'i']);
    return v;
  },
  'cavalcade': (ctx, seed, o = {}) => {
    const v = new Voice(ctx, seed);
    const bpm = 104, beat = 60 / bpm;
    // the riders' murmur and the pool's edge are always there
    murmur(v, 0.02, ['a', 'o', 'e']);
    waterFlow(v, 0.012, 2000, 1);
    // hoof patter: many clicks around the ring, loosely in 6/8 gallop
    for (let k = 0; k < 2; k++) {
      v.pattern(k * 0.11, (t) => {
        const f = v.rng.range(350, 900);
        burst(ctx, v.out, v.rng, { t0: t, dur: 0.05, tau: 0.012, gain: 0.09, filter: { type: 'bandpass', f, Q: 2.5 } });
        tone(ctx, v.out, { t0: t, dur: 0.06, f: v.rng.range(120, 220), type: 'sine', gain: 0.05, a: 0.003 });
        const sub = v.rng.pick([1, 1, 2, 3]) * (beat / 3);
        return sub * v.rng.range(0.92, 1.08);
      });
    }
    if (!o.music) return v;
    markMusic();
    // tabor: dum . da dum . .
    let step = 0;
    v.pattern(0.05, (t) => {
      const accent = [1, 0, 0.5, 0.8, 0, 0][step % 6];
      if (accent) drum(ctx, v.out, v.rng, { t0: t, f: 95, gain: 0.12 * accent, dur: 0.3, snap: 0.3, snapF: 1500 });
      step++;
      return beat / 2;
    });
    // recorder melody: dorian random walk, phrases of 6-10 notes then a breath
    const rec = filter(ctx, 'lowpass', 3200, 0.7);
    rec.connect(v.out);
    let deg = 3, inPhrase = 0;
    v.pattern(0.3, (t) => {
      if (inPhrase <= 0) { inPhrase = v.rng.int(6, 10); return beat * v.rng.pick([1, 1.5, 2]); }
      inPhrase--;
      deg = Math.max(0, Math.min(DORIAN_D.length - 1, deg + v.rng.pick([-2, -1, -1, 0, 1, 1, 2])));
      const len = beat * v.rng.pick([0.5, 0.5, 1, 1, 1.5]);
      const f = mtof(DORIAN_D[deg] + 12);
      tone(ctx, rec, { t0: t, dur: len * 0.92, f, type: 'triangle', gain: 0.07, a: 0.03, r: 0.05, vib: { rate: 5.5, depth: 8 } });
      tone(ctx, rec, { t0: t, dur: len * 0.92, f: f * 2, type: 'sine', gain: 0.012, a: 0.03, r: 0.05 });
      return len;
    });
    // shawm: nasal drone on D, breathing in and out every few bars
    v.pattern(1.2, (t) => {
      const dur = beat * v.rng.int(3, 6);
      tone(ctx, v.out, { t0: t, dur, f: mtof(62), type: 'sawtooth', gain: 0.03, a: 0.3, r: 0.4, filter: { type: 'bandpass', f: 1250, Q: 2.2 }, vib: { rate: 4.8, depth: 6 } });
      return dur + beat * v.rng.int(2, 6);
    });
    return v;
  },
  'giant-birds': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    v.pattern(0.2, (t) => SPECIES[v.rng.pick<SpeciesName>(['giant', 'crow', 'duck', 'hoopoe', 'woodpecker', 'giant'])](ctx, v.out, v.rng, t, 0.08) + v.rng.range(0.8, 3.5));
    v.pattern(0.9, (t) => SPECIES.flap(ctx, v.out, v.rng, t, 0.05) + v.rng.range(1, 4));
    murmur(v, 0.012, ['a', 'o', 'e']);
    return v;
  },
  'mermaids': (ctx, seed, o = {}) => {
    const v = new Voice(ctx, seed);
    waterFlow(v, 0.07, 1800, 1);
    splashes(v, 0.14, 0.6, 2.5);
    // breathy, wordless whispers from the water (noise through vowels, no pitch)
    murmur(v, 0.12, ['u', 'o', 'a']);
    if (!o.music) return v;
    markMusic();
    // two sustained siren voices a fifth apart, vowels and pitch drifting slowly
    const lp = filter(ctx, 'lowpass', 2600, 0.7);
    lp.connect(v.out);
    ([[220, 'o'], [330, 'u']] satisfies [number, Vowel][]).forEach(([f, vw], i) => {
      const fb = formantBank(ctx, vw, 10);
      const g = gainNode(ctx, 0.2);
      fb.output.connect(g).connect(lp);
      v.lfo(g.gain, 0.11 + i * 0.04, 0.08);
      const oscs = [-7, 0, 7].map((d) => { const o = v.osc('sawtooth', f, 1, d); o.connect(fb.input); return o.osc; });
      v.pattern(i * 1.3, (t) => {
        fb.setVowel(t, v.rng.pick<Vowel>(['o', 'u', 'a', 'e']), 0.8);
        const target = f * Math.pow(2, v.rng.pick([-3, -2, 0, 2, 3, 5]) / 12);
        for (const o of oscs) o.frequency.setTargetAtTime(target, t, 0.6);
        return v.rng.range(1.8, 4.5);
      });
    });
    return v;
  },
  'fountain-adultery': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    waterFlow(v, 0.07, 2200, 1.2);
    const fall = v.noise('pink', { type: 'bandpass', f: 700, Q: 0.6 }, 0.06);
    v.lfo(fall.gain, 0.3, 0.025);
    bloops(v, 0.04, 0.2, 0.8);
    // low intimate murmurs from inside the sphere
    v.pattern(1, (t) => {
      const f = v.rng.range(110, 170);
      vowelNote(ctx, v.out, { t0: t, dur: 0.6, f, f1: f * 1.08, vowels: [['m', 0], ['o', 0.5]], gain: 0.08, a: 0.15, r: 0.25 });
      return v.rng.range(2, 5);
    });
    return v;
  },
  'lovers-murmur': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    v.pattern(0.3, (t) => {
      const f = v.rng.range(120, 230);
      const dur = v.rng.range(0.35, 0.9);
      vowelNote(ctx, v.out, { t0: t, dur, f, f1: f * v.rng.range(0.9, 1.15), vowels: [['m', 0], [v.rng.pick(['o', 'u', 'e']), 0.4]], gain: 0.12, a: 0.1, r: 0.2 });
      return dur + v.rng.range(0.8, 3);
    });
    // glassy ring (the transparent sphere)
    const ring = v.osc('sine', 1760, 0.015);
    ring.connect(v.out);
    v.lfo(ring.gain, 0.23, 0.01);
    v.pattern(2, (t) => laugh(v, v.out, t, 0.05) + v.rng.range(4, 10));
    return v;
  },
  'crowd-murmur': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    murmur(v, 0.045);
    v.pattern(1, (t) => laugh(v, v.out, t, 0.03) + v.rng.range(2.5, 7));
    // fruit bites: crisp crunch
    v.pattern(0.6, (t) => {
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.09, kind: 'white', tau: 0.025, gain: 0.035, filter: { type: 'bandpass', f: 2800, Q: 1.2, f1: 900 } });
      return v.rng.range(1.5, 5);
    });
    return v;
  },
  'wild-men': (ctx, seed, o = {}) => {
    const v = new Voice(ctx, seed);
    murmur(v, 0.09, ['u', 'o', 'a']);
    // sticks knocked together, undergrowth
    v.pattern(0.4, (t) => {
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.04, tau: 0.008, gain: 0.12, filter: { type: 'bandpass', f: 1500, Q: 3 } });
      return v.rng.range(0.3, 1.2);
    });
    v.pattern(0.9, (t) => {
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.2, kind: 'pink', a: 0.03, r: 0.1, gain: 0.09, filter: { type: 'bandpass', f: 2200, Q: 0.8 } });
      return v.rng.range(0.8, 3);
    });
    if (!o.music) return v;
    markMusic();
    let n = 0;
    v.pattern(0.1, (t) => {
      const acc = [1, 0.4, 0.7, 0.4, 1, 0.5, 0.4][n++ % 7];
      drum(ctx, v.out, v.rng, { t0: t, f: 130, gain: 0.1 * acc, dur: 0.25, snap: 0.5, snapF: 2200 });
      return 0.26 * v.rng.range(0.96, 1.04);
    });
    v.pattern(1, (t) => {
      const f = v.rng.pick([98, 110, 123]);
      vowelNote(ctx, v.out, { t0: t, dur: 1.2, f, vowels: [['u', 0], ['o', 0.5]], gain: 0.05, a: 0.1, r: 0.4, voices: 3 });
      return v.rng.range(2.5, 6);
    });
    return v;
  },

  // --- Hell ---------------------------------------------------------------------

  'music-hell': (ctx, seed, o = {}) => {
    const v = new Voice(ctx, seed);
    // the damned strapped to the giant instruments: groans, straining wood, chains
    v.pattern(0.3, (t) => groan(v, v.out, t, 0.1) + v.rng.range(2, 6));
    v.pattern(1.1, (t) => creak(v, v.out, t, 0.09) + v.rng.range(1.5, 5));
    v.pattern(0.7, (t) => chainRattle(v, v.out, t, 0.04) + v.rng.range(2.5, 7));
    const wind = v.noise('pink', { type: 'bandpass', f: 450, Q: 1.5 }, 0.03);
    v.lfo(wind.filter.frequency, 0.06, 150);
    if (!o.music) return v;
    markMusic();
    // hurdy-gurdy: drone strings plus the buzzing trompette (fast AM)
    const hg = filter(ctx, 'lowpass', 1600, 1.5);
    hg.connect(v.out);
    const hgMix = gainNode(ctx, 0.05);
    hgMix.connect(hg);
    v.osc('sawtooth', mtof(50), 1, -5).connect(hgMix);
    v.osc('sawtooth', mtof(57), 1, 6).connect(hgMix);
    const buzz = v.osc('sawtooth', mtof(62), 0.6);
    buzz.connect(hgMix);
    v.lfo(buzz.gain, 5.2, 0.5, 'square');
    v.lfo(hgMix.gain, 0.6, 0.012);
    // harp arpeggios and lute plucks in D dorian
    v.pattern(0.3, (t) => {
      const n = v.rng.int(4, 8), step = v.rng.range(0.1, 0.18);
      let d = v.rng.int(0, 4);
      for (let i = 0; i < n; i++) {
        d = Math.max(0, Math.min(DORIAN_D.length - 1, d + v.rng.pick([1, 1, 2, -1])));
        pluck(ctx, v.out, { t0: t + i * step, f: mtof(DORIAN_D[d] + 12), gain: 0.06, dur: 1.8, bright: 9 });
      }
      return n * step + v.rng.range(1, 3.5);
    });
    v.pattern(0.9, (t) => {
      pluck(ctx, v.out, { t0: t, f: mtof(v.rng.pick(DORIAN_D) - 12), gain: 0.08, dur: 1.4, bright: 6 });
      return v.rng.pick([0.35, 0.35, 0.7, 1.05]);
    });
    // horn blasts
    v.pattern(2, (t) => {
      const f = mtof(v.rng.pick([38, 41, 45]));
      tone(ctx, v.out, { t0: t, dur: 1.1, f: f * 0.97, f1: f, type: 'sawtooth', gain: 0.07, a: 0.08, r: 0.3, filter: { type: 'lowpass', f: 900, Q: 2 }, vib: { rate: 4, depth: 10 } });
      return v.rng.range(4, 11);
    });
    // big drum
    v.pattern(0.5, (t) => {
      drum(ctx, v.out, v.rng, { t0: t, f: 60, gain: 0.16, dur: 0.6, snap: 0.2, snapF: 900 });
      return v.rng.pick([1.1, 1.1, 1.65, 2.2]);
    });
    return v;
  },
  'ear-knife': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    // grinding: two sharp resonances sweeping over white noise, rough AM
    const grind = gainNode(ctx, 0.06);
    grind.connect(v.out);
    v.lfo(grind.gain, 23, 0.025);
    const src = v.noise('white', null, 1);
    src.disconnect();
    [1700, 3300].forEach((f, i) => {
      const bp = filter(ctx, 'bandpass', f, 14);
      src.connect(bp).connect(grind);
      v.lfo(bp.frequency, 0.37 + i * 0.1, f * 0.25);
    });
    // scrape of the blade
    v.pattern(0.6, (t) => {
      const dur = v.rng.range(0.4, 1.1);
      burst(ctx, v.out, v.rng, { t0: t, dur, kind: 'white', a: 0.05, r: dur * 0.4, gain: 0.07, filter: { type: 'bandpass', f: v.rng.range(2500, 4500), Q: 8, f1: v.rng.range(900, 1800) } });
      return dur + v.rng.range(0.8, 3);
    });
    v.pattern(2, (t) => {
      clang(ctx, v.out, { t0: t, f: v.rng.range(500, 1300), gain: 0.05, dur: 1.2, rng: v.rng, strike: true });
      return v.rng.range(2, 6);
    });
    return v;
  },
  'city-fire': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    const roar = v.noise('brown', { type: 'bandpass', f: 380, Q: 0.7 }, 0.12);
    v.lfo(roar.gain, 9.5, 0.04);
    v.lfo(roar.gain, 0.4, 0.03);
    v.lfo(roar.filter.frequency, 0.23, 140);
    const hiss = v.noise('white', { type: 'highpass', f: 3000, Q: 0.7 }, 0.012);
    v.lfo(hiss.gain, 13, 0.006);
    v.pattern(0.1, (t) => {
      const n = v.rng.int(1, 5);
      for (let i = 0; i < n; i++) burst(ctx, v.out, v.rng, { t0: t + i * v.rng.range(0.015, 0.06), dur: 0.03, tau: 0.004, gain: v.rng.range(0.04, 0.09), filter: { type: 'highpass', f: 2200, Q: 0.7 } });
      return v.rng.range(0.05, 0.45);
    });
    v.pattern(1.5, (t) => {
      const dur = v.rng.range(1.2, 2.5);
      burst(ctx, v.out, v.rng, { t0: t, dur, kind: 'brown', tau: dur * 0.3, a: 0.01, gain: 0.45, filter: { type: 'lowpass', f: v.rng.range(150, 400), Q: 1 } });
      tone(ctx, v.out, { t0: t, dur: 0.5, f: 60, f1: 32, gain: 0.3, a: 0.005 });
      burst(ctx, v.out, v.rng, { t0: t + 0.3, dur: 0.8, kind: 'white', a: 0.1, r: 0.5, gain: 0.05, filter: { type: 'bandpass', f: 1500, Q: 0.6 } }); // debris
      return v.rng.range(4, 11);
    });
    return v;
  },
  'ice-skating': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    const wind = v.noise('pink', { type: 'bandpass', f: 1400, Q: 1.5 }, 0.025);
    v.lfo(wind.filter.frequency, 0.08, 500);
    v.lfo(wind.gain, 0.19, 0.012);
    // skate scrapes alternating left/right stroke rhythm
    v.pattern(0.1, (t) => {
      const dur = v.rng.range(0.3, 0.55);
      burst(ctx, v.out, v.rng, { t0: t, dur, kind: 'white', a: 0.04, r: dur * 0.5, gain: 0.06, filter: { type: 'highpass', f: v.rng.range(2500, 4000), Q: 1 } });
      return dur + v.rng.range(0.15, 0.4);
    });
    // ice creak: resonant descending sweep
    v.pattern(1.5, (t) => {
      const f = v.rng.range(900, 1600);
      tone(ctx, v.out, { t0: t, dur: v.rng.range(0.3, 0.9), f, f1: f * v.rng.range(0.2, 0.4), type: 'sawtooth', gain: 0.06, a: 0.02, filter: { type: 'bandpass', f: f * 1.5, Q: 6, f1: f * 0.5 } });
      return v.rng.range(1.5, 5);
    });
    // deep ice crack
    v.pattern(4, (t) => {
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.5, kind: 'brown', tau: 0.12, gain: 0.3, filter: { type: 'lowpass', f: 300, Q: 2 } });
      tone(ctx, v.out, { t0: t, dur: 0.25, f: 220, f1: 70, type: 'square', gain: 0.05, a: 0.003 });
      return v.rng.range(6, 15);
    });
    return v;
  },
  'gambling': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    murmur(v, 0.02, ['a', 'e', 'o']);
    v.pattern(0.4, (t) => {
      // dice rattle in a cup, then thrown onto the board
      const n = v.rng.int(7, 16);
      let tt = t;
      for (let i = 0; i < n; i++) {
        burst(ctx, v.out, v.rng, { t0: tt, dur: 0.025, tau: 0.004, gain: 0.07, filter: { type: 'bandpass', f: v.rng.range(2500, 4500), Q: 3 } });
        tt += v.rng.range(0.03, 0.09);
      }
      drum(ctx, v.out, v.rng, { t0: tt + 0.1, f: 200, gain: 0.08, dur: 0.15, snap: 1, snapF: 3000 });
      for (let i = 0; i < 3; i++) burst(ctx, v.out, v.rng, { t0: tt + 0.15 + i * v.rng.range(0.04, 0.1), dur: 0.02, tau: 0.004, gain: 0.05, filter: { type: 'bandpass', f: 3500, Q: 4 } });
      return tt - t + v.rng.range(1.5, 4.5);
    });
    // coins
    v.pattern(1.1, (t) => {
      const n = v.rng.int(1, 4);
      for (let i = 0; i < n; i++) clang(ctx, v.out, { t0: t + i * 0.09, f: v.rng.range(3000, 5200), gain: 0.03, dur: 0.5, ratios: BELL_RATIOS.slice(1, 5) });
      return v.rng.range(2, 6);
    });
    return v;
  },
  'armies': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    let n = 0;
    v.pattern(0.05, (t) => {
      const acc = n++ % 4 === 0 ? 1 : 0.55;
      drum(ctx, v.out, v.rng, { t0: t, f: 75, gain: 0.16 * acc, dur: 0.4, snap: 0.35, snapF: 1200 });
      if (n % 2 === 0) drum(ctx, v.out, v.rng, { t0: t + 0.25, f: 140, gain: 0.06, dur: 0.15, snap: 0.8, snapF: 2500 });
      return 0.5;
    });
    // feet: a wash of many steps
    const tramp = v.noise('pink', { type: 'bandpass', f: 300, Q: 1 }, 0.04);
    v.lfo(tramp.gain, 2, 0.03, 'triangle');
    // clashing metal
    v.pattern(0.7, (t) => {
      clang(ctx, v.out, { t0: t, f: v.rng.range(700, 1600), gain: 0.07, dur: 0.8, rng: v.rng, strike: true, spread: 3 });
      if (v.rng.chance(0.4)) clang(ctx, v.out, { t0: t + v.rng.range(0.05, 0.2), f: v.rng.range(500, 1200), gain: 0.05, dur: 0.6, rng: v.rng, strike: true });
      return v.rng.range(0.6, 2.5);
    });
    // distant horn
    v.pattern(3, (t) => {
      tone(ctx, v.out, { t0: t, dur: 1.2, f: 165, f1: 175, type: 'sawtooth', gain: 0.04, a: 0.1, r: 0.4, filter: { type: 'lowpass', f: 1100, Q: 1.5 } });
      return v.rng.range(6, 14);
    });
    return v;
  },
  'key-clank': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    v.pattern(0.3, (t) => {
      clang(ctx, v.out, { t0: t, f: v.rng.range(160, 230), gain: 0.12, dur: 2.2, rng: v.rng, strike: true });
      return v.rng.range(2.5, 7);
    });
    v.pattern(1, (t) => chainRattle(v, v.out, t, 0.05) + v.rng.range(1.5, 5));
    const rumble = v.noise('brown', { type: 'lowpass', f: 120, Q: 1 }, 0.05);
    v.lfo(rumble.gain, 0.2, 0.02);
    return v;
  },
  'potty-bird': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    // gulps: falling pitch through a throat-like formant, then a wet bubble
    v.pattern(0.3, (t) => {
      const f = v.rng.range(200, 280);
      tone(ctx, v.out, { t0: t, dur: 0.38, f, f1: f * 0.3, type: 'sawtooth', gain: 0.1, a: 0.02, r: 0.1, filter: { type: 'bandpass', f: 520, Q: 3, f1: 220 } });
      burst(ctx, v.out, v.rng, { t0: t + 0.3, dur: 0.2, kind: 'pink', a: 0.02, r: 0.1, gain: 0.05, filter: { type: 'lowpass', f: 900, Q: 4, f1: 250 } });
      return v.rng.range(1.5, 4.5);
    });
    // bubbling below
    v.pattern(0.1, (t) => {
      tone(ctx, v.out, { t0: t, dur: 0.08, f: v.rng.range(250, 500), f1: v.rng.range(500, 900), type: 'sine', gain: 0.03 });
      return v.rng.range(0.15, 0.7);
    });
    const low = v.noise('brown', { type: 'lowpass', f: 200, Q: 1 }, 0.06);
    v.lfo(low.gain, 0.4, 0.02);
    return v;
  },
  'tree-man': (ctx, seed, o = {}) => {
    const v = new Voice(ctx, seed);
    // tavern murmur heard through the hollow torso: a resonant cavity around 200 Hz
    const cavity = filter(ctx, 'bandpass', 210, 3);
    const dark = filter(ctx, 'lowpass', 900, 0.7);
    cavity.connect(v.out);
    dark.connect(v.out);
    const m = murmur(v, 0.25, ['o', 'u', 'm', 'a']);
    m.disconnect();
    m.connect(cavity);
    m.connect(dark);
    v.pattern(1.2, (t) => {
      const f = v.rng.range(100, 160);
      vowelNote(ctx, dark, { t0: t, dur: v.rng.range(0.4, 0.9), f, f1: f * 1.1, vowels: [['m', 0], ['o', 0.5]], gain: 0.12, a: 0.1, r: 0.2 });
      return v.rng.range(1.5, 4);
    });
    // tankards and the barrel tap
    v.pattern(2, (t) => {
      clang(ctx, dark, { t0: t, f: v.rng.range(1800, 2600), gain: 0.03, dur: 0.6, ratios: BELL_RATIOS.slice(1, 5) });
      return v.rng.range(3, 8);
    });
    v.pattern(3, (t) => laugh(v, dark, t, 0.02) + v.rng.range(5, 12));
    if (!o.music) return v;
    markMusic();
    // the bagpipe on his head, a faint reedy drone
    const pipe = v.osc('sawtooth', mtof(50), 0.05);
    const pipeF = filter(ctx, 'bandpass', 600, 2);
    pipe.connect(pipeF).connect(v.out);
    v.lfo(pipe.osc.detune, 0.3, 6);
    v.lfo(pipe.gain, 0.15, 0.01);
    return v;
  },
  'buttock-song': (ctx, seed, o = {}) => {
    const v = new Voice(ctx, seed);
    // the sinner crushed under the giant lute: groans, the lute's timber creaking, a thud
    v.pattern(0.2, (t) => groan(v, v.out, t, 0.12) + v.rng.range(2, 6));
    v.pattern(1, (t) => creak(v, v.out, t, 0.08) + v.rng.range(2, 6));
    v.pattern(2.5, (t) => {
      drum(ctx, v.out, v.rng, { t0: t, f: 55, gain: 0.12, dur: 0.5, snap: 0.15, snapF: 600 });
      return v.rng.range(5, 12);
    });
    if (!o.music) return v;
    markMusic();
    const beat = 60 / BUTTOCK_SONG.tempo;
    const notes = BUTTOCK_SONG.notes;
    const choir = filter(ctx, 'lowpass', 3000, 0.7);
    choir.connect(v.out);
    const luteBus = gainNode(ctx, 0.6);
    luteBus.connect(v.out);
    const vowels: Vowel[] = ['a', 'o', 'e', 'u', 'o', 'a'];
    let i = 0;
    v.pattern(0.4, (t) => {
      if (i >= notes.length) { i = 0; return beat * 3; } // rest between repeats
      const n = notes[i];
      const vw = vowels[i % vowels.length];
      i++;
      const dur = n.beats * beat;
      if (n.midi == null) return dur;
      const f = mtof(n.midi);
      // choir: three voices, slight detune, octave doubling below for weight
      vowelNote(ctx, choir, { t0: t, dur: dur * 0.95, f, vowels: [[vw, 0], [vowels[(i + 2) % vowels.length], 0.7]], gain: 0.14, a: 0.08, r: 0.18, voices: 3, detune: 7, vib: { rate: 4.6, depth: 7 } });
      vowelNote(ctx, choir, { t0: t, dur: dur * 0.95, f: f / 2, vowels: [[vw, 0]], gain: 0.035, a: 0.1, r: 0.2, voices: 2, detune: 5 });
      pluck(ctx, luteBus, { t0: t, f, gain: 0.07, dur: 1.2, bright: 6 });
      if (n.beats > 1) pluck(ctx, luteBus, { t0: t + beat, f: f / 2, gain: 0.05, dur: 1.4, bright: 5 });
      return dur;
    });
    return v;
  },
  'sinners-groans': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    v.pattern(0.2, (t) => groan(v, v.out, t, 0.14) + v.rng.range(1.5, 5));
    v.pattern(1.5, (t) => groan(v, v.out, t, 0.09) + v.rng.range(3, 8));
    v.pattern(0.8, (t) => chainRattle(v, v.out, t, 0.06) + v.rng.range(2, 7));
    const wind = v.noise('pink', { type: 'bandpass', f: 400, Q: 1.5 }, 0.05);
    v.lfo(wind.filter.frequency, 0.06, 150);
    return v;
  },
  'rot-flies': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    // fly swarm: saws with jittering pitch through a narrow band
    for (let k = 0; k < 2; k++) {
      const f = [150, 210][k];
      const fly = v.osc('sawtooth', f, 0.07);
      const bp = filter(ctx, 'bandpass', 900 + k * 300, 1.5);
      fly.connect(bp).connect(v.out);
      v.lfo(fly.osc.frequency, 6.5 + k, 14);
      v.lfo(fly.osc.frequency, 0.37 + k * 0.1, 30);
      v.lfo(fly.gain, 1.7 + k * 0.5, 0.03);
    }
    v.pattern(1, (t) => groan(v, v.out, t, 0.04) + v.rng.range(3, 8));
    // drips of something
    v.pattern(0.5, (t) => {
      tone(ctx, v.out, { t0: t, dur: 0.06, f: 500, f1: 1400, gain: 0.03 });
      return v.rng.range(0.6, 2.5);
    });
    return v;
  },
  'clogs-knock': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    const knock = (t: number, gain: number) => {
      tone(ctx, v.out, { t0: t, dur: 0.12, f: 190, f1: 150, type: 'sine', gain: gain * 1.2, a: 0.002, r: 0.1 });
      burst(ctx, v.out, v.rng, { t0: t, dur: 0.04, tau: 0.008, gain, filter: { type: 'bandpass', f: 1300, Q: 3 } });
    };
    v.pattern(0.2, (t) => {
      const n = v.rng.int(2, 4);
      for (let i = 0; i < n; i++) knock(t + i * v.rng.range(0.14, 0.24), 0.09);
      return n * 0.2 + v.rng.range(1, 3.5);
    });
    v.pattern(1.5, (t) => groan(v, v.out, t, 0.035) + v.rng.range(4, 9));
    const wind = v.noise('pink', { type: 'bandpass', f: 500, Q: 1 }, 0.02);
    v.lfo(wind.filter.frequency, 0.07, 200);
    return v;
  },
  'clangs': (ctx, seed) => {
    const v = new Voice(ctx, seed);
    v.pattern(0.2, (t) => {
      clang(ctx, v.out, { t0: t, f: v.rng.range(350, 1300), gain: 0.08, dur: 1.4, rng: v.rng, strike: true });
      return v.rng.range(1, 4);
    });
    v.pattern(0.9, (t) => chainRattle(v, v.out, t, 0.04) + v.rng.range(2, 6));
    const rumble = v.noise('brown', { type: 'lowpass', f: 150, Q: 1 }, 0.06);
    v.lfo(rumble.gain, 0.17, 0.025);
    return v;
  },
} satisfies Record<string, VoiceFactory>;

export const VOICE_NAMES = Object.keys(VOICES) as VoiceType[];

// Which section bus (and therefore which reverb) each voice type belongs to.
export const VOICE_PANEL: Record<VoiceType, PanelId> = {
  'fountain-owl': 'eden', 'swans': 'eden', 'meadow-beasts': 'eden', 'frogs-reptiles': 'eden',
  'bird-flock': 'eden', 'beasts-fighting': 'eden', 'birds-eden': 'eden', 'water-trickle': 'eden',
  'birds-garden': 'garden', 'splash-pool': 'garden', 'cavalcade': 'garden', 'giant-birds': 'garden',
  'mermaids': 'garden', 'fountain-adultery': 'garden', 'lovers-murmur': 'garden', 'crowd-murmur': 'garden', 'wild-men': 'garden',
  'music-hell': 'hell', 'ear-knife': 'hell', 'city-fire': 'hell', 'ice-skating': 'hell', 'gambling': 'hell',
  'armies': 'hell', 'key-clank': 'hell', 'potty-bird': 'hell', 'tree-man': 'hell', 'buttock-song': 'hell',
  'sinners-groans': 'hell', 'rot-flies': 'hell', 'clogs-knock': 'hell', 'clangs': 'hell',
};

// Output trims (linear) so every voice lands near -12 dBFS peak / -28 dBFS RMS
// at gain 1 before the master; tuned from the offline test's raw columns.
export const TRIM: Record<VoiceType, number> = {
  'fountain-owl': 1.3, 'swans': 3.5, 'meadow-beasts': 5, 'frogs-reptiles': 2.5, 'bird-flock': 4.5,
  'beasts-fighting': 2.5, 'birds-eden': 1.5, 'water-trickle': 1.5,
  'birds-garden': 3.5, 'splash-pool': 3.5, 'cavalcade': 1, 'giant-birds': 4.5, 'mermaids': 0.4,
  'fountain-adultery': 1.8, 'lovers-murmur': 2, 'crowd-murmur': 7, 'wild-men': 1.6,
  'music-hell': 0.8, 'ear-knife': 2, 'city-fire': 0.7, 'ice-skating': 1.8, 'gambling': 2, 'armies': 1,
  'key-clank': 0.9, 'potty-bird': 2, 'tree-man': 2, 'buttock-song': 1, 'sinners-groans': 1.6,
  'rot-flies': 1, 'clogs-knock': 1.6, 'clangs': 1.3,
};

export function createVoice(type: VoiceType, ctx: BaseAudioContext, seed: number, o: { music?: boolean } = {}): Voice {
  const f = VOICES[type];
  if (!f) throw new Error(`unknown voice type ${type}`);
  const v = f(ctx, seed, { music: !!o.music });
  v.out.gain.value = TRIM[type] ?? 1;
  return v;
}
