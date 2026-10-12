// Bird species as phrase generators. Each species(ctx, dest, rng, t0, gain)
// schedules one phrase starting at t0 and returns its duration. Phrases are
// randomized within species-like constraints so nothing loops audibly.

import { tone, burst } from './dsp.js';

const chirp = (ctx, dest, o) => tone(ctx, dest, { type: 'sine', a: 0.004, ...o });

export const SPECIES = {
  // fast descending trill
  warbler(ctx, dest, rng, t0, gain) {
    const n = rng.int(6, 14), step = rng.range(0.045, 0.08);
    const f0 = rng.range(3000, 4200);
    for (let i = 0; i < n; i++) {
      const f = f0 * Math.pow(0.985, i) * rng.range(0.98, 1.02);
      chirp(ctx, dest, { t0: t0 + i * step, dur: step * 0.7, f, f1: f * rng.range(0.75, 0.9), gain: gain * rng.range(0.6, 1) });
    }
    return n * step;
  },
  // varied phrase of 3-5 sliding notes, repeated motifs
  thrush(ctx, dest, rng, t0, gain) {
    const n = rng.int(3, 5);
    let t = t0;
    const motif = rng.range(1800, 3200);
    for (let i = 0; i < n; i++) {
      const dur = rng.range(0.08, 0.18);
      const f = motif * rng.range(0.8, 1.25);
      chirp(ctx, dest, { t0: t, dur, f, f1: f * (rng.chance(0.5) ? rng.range(1.1, 1.5) : rng.range(0.65, 0.9)), gain: gain * rng.range(0.7, 1) });
      t += dur + rng.range(0.03, 0.12);
    }
    return t - t0;
  },
  // fluty, lower, slow slides
  blackbird(ctx, dest, rng, t0, gain) {
    const n = rng.int(2, 4);
    let t = t0;
    for (let i = 0; i < n; i++) {
      const dur = rng.range(0.16, 0.32);
      const f = rng.range(1500, 2600);
      chirp(ctx, dest, { t0: t, dur, f, f1: f * rng.range(0.8, 1.3), gain: gain * 0.9, a: 0.02, vib: { rate: 22, depth: 40 } });
      t += dur + rng.range(0.05, 0.15);
    }
    return t - t0;
  },
  // quick ascending chatter
  finch(ctx, dest, rng, t0, gain) {
    const n = rng.int(4, 9), step = rng.range(0.05, 0.075);
    const f0 = rng.range(2600, 3400);
    for (let i = 0; i < n; i++) {
      const f = f0 * Math.pow(1.03, i);
      chirp(ctx, dest, { t0: t0 + i * step, dur: step * 0.6, f, f1: f * 1.2, gain: gain * 0.8 });
    }
    return n * step;
  },
  // two notes, descending major third, soft
  cuckoo(ctx, dest, rng, t0, gain) {
    const f = rng.range(700, 760);
    chirp(ctx, dest, { t0, dur: 0.22, f, gain: gain * 1.2, a: 0.03, filter: { type: 'lowpass', f: 2000 } });
    chirp(ctx, dest, { t0: t0 + 0.34, dur: 0.28, f: f * 0.8, gain: gain * 1.2, a: 0.03, filter: { type: 'lowpass', f: 2000 } });
    return 0.7;
  },
  // soft "oop-oop-oop"
  hoopoe(ctx, dest, rng, t0, gain) {
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      chirp(ctx, dest, { t0: t0 + i * 0.19, dur: 0.12, f: rng.range(380, 430), gain: gain * 1.3, a: 0.02, filter: { type: 'lowpass', f: 1200 } });
    }
    return n * 0.19;
  },
  // drumming on wood
  woodpecker(ctx, dest, rng, t0, gain) {
    const n = rng.int(8, 16), step = rng.range(0.045, 0.06);
    for (let i = 0; i < n; i++) {
      burst(ctx, dest, rng, { t0: t0 + i * step, dur: 0.03, tau: 0.006, gain: gain * 1.4, filter: { type: 'bandpass', f: 900, Q: 2.5 } });
    }
    return n * step;
  },
  // thin high "tsee" with ripples
  robin(ctx, dest, rng, t0, gain) {
    const n = rng.int(3, 6);
    let t = t0;
    for (let i = 0; i < n; i++) {
      const dur = rng.range(0.06, 0.14);
      const f = rng.range(3500, 5200);
      chirp(ctx, dest, { t0: t, dur, f, f1: f * rng.range(0.7, 1.2), gain: gain * 0.6 });
      t += dur + rng.range(0.02, 0.09);
    }
    return t - t0;
  },
  // nasal quack
  duck(ctx, dest, rng, t0, gain) {
    const n = rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const f = rng.range(240, 300);
      tone(ctx, dest, { t0: t0 + i * 0.22, dur: 0.14, f: f * 1.15, f1: f, type: 'sawtooth', gain: gain * 0.5, a: 0.01, filter: { type: 'bandpass', f: 1100, Q: 1.6 } });
    }
    return n * 0.22;
  },
  // trumpeting honk, low and brassy
  swan(ctx, dest, rng, t0, gain) {
    const f = rng.range(300, 380);
    tone(ctx, dest, { t0, dur: 0.45, f: f * 0.9, f1: f, type: 'sawtooth', gain: gain * 0.5, a: 0.04, filter: { type: 'bandpass', f: 900, Q: 1.1, f1: 1300 } });
    if (rng.chance(0.5)) tone(ctx, dest, { t0: t0 + 0.55, dur: 0.3, f: f * 1.05, f1: f * 0.95, type: 'sawtooth', gain: gain * 0.4, a: 0.04, filter: { type: 'bandpass', f: 1000, Q: 1.1 } });
    return 0.9;
  },
  // harsh descending screech for the oversized birds
  giant(ctx, dest, rng, t0, gain) {
    const f = rng.range(600, 1100);
    tone(ctx, dest, { t0, dur: rng.range(0.4, 0.8), f, f1: f * 0.55, type: 'sawtooth', gain: gain * 0.5, a: 0.03, filter: { type: 'bandpass', f: 1600, Q: 1.3, f1: 900 }, vib: { rate: 14, depth: 60 } });
    return 1.0;
  },
  // hoo-hoo
  owl(ctx, dest, rng, t0, gain) {
    const f = rng.range(360, 420);
    chirp(ctx, dest, { t0, dur: 0.3, f, f1: f * 0.94, type: 'triangle', gain: gain * 1.1, a: 0.06, filter: { type: 'lowpass', f: 900 } });
    chirp(ctx, dest, { t0: t0 + 0.55, dur: 0.6, f: f * 0.97, f1: f * 0.88, type: 'triangle', gain: gain, a: 0.08, filter: { type: 'lowpass', f: 900 } });
    return 1.3;
  },
  // rough caw
  crow(ctx, dest, rng, t0, gain) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const f = rng.range(330, 420);
      tone(ctx, dest, { t0: t0 + i * 0.4, dur: 0.25, f: f * 1.1, f1: f * 0.9, type: 'sawtooth', gain: gain * 0.45, a: 0.02, filter: { type: 'bandpass', f: 1400, Q: 0.9 } });
    }
    return n * 0.4;
  },
  // wing flaps: short soft noise puffs
  flap(ctx, dest, rng, t0, gain) {
    const n = rng.int(3, 7), step = rng.range(0.11, 0.16);
    for (let i = 0; i < n; i++) {
      burst(ctx, dest, rng, { t0: t0 + i * step, dur: 0.09, kind: 'pink', a: 0.02, r: 0.05, gain: gain * 1.5, filter: { type: 'bandpass', f: 500, Q: 0.7 } });
    }
    return n * step;
  },
};

export const SONGBIRDS = ['warbler', 'thrush', 'blackbird', 'finch', 'robin'];

/**
 * Register a bird-chorus pattern on a Voice: random species from `pool`
 * every `gapMin..gapMax` seconds, lowpassed for distance.
 */
export function addBirdChorus(voice, dest, pool, { gain = 0.05, gapMin = 1, gapMax = 4, delay = 0 } = {}) {
  const rng = voice.rng;
  voice.pattern(delay + rng.range(0, gapMax * 0.5), (t) => {
    const sp = SPECIES[rng.pick(pool)];
    const dur = sp(voice.ctx, dest, rng, t, gain * rng.range(0.6, 1));
    return dur + rng.range(gapMin, gapMax);
  });
}
