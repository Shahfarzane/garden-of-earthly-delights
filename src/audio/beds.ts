// Section beds ('nature' layer): one continuous real-world ambience per panel,
// crossfaded by the view. No pads or drones; period music lives in music.ts.

import { Voice, burst, clang, tone, BELL_RATIOS, filter } from './dsp.ts';
import { addBirdChorus } from './birds.ts';
import type { PanelId } from '../scene.ts';

// A section bed: one continuous ambience per panel.
export type Bed = (ctx: BaseAudioContext, seed: number) => Voice;

export function edenBed(ctx: BaseAudioContext, seed: number): Voice {
  const v = new Voice(ctx, seed);
  // breeze: pink noise through a wandering bandpass
  const breeze = v.noise('pink', { type: 'bandpass', f: 650, Q: 0.6 }, 0.045);
  v.lfo(breeze.filter.frequency, 0.09, 300);
  v.lfo(breeze.gain, 0.13, 0.02);
  // trickling water: fast double-LFO amplitude ripple on high filtered noise
  const trickle = v.noise('white', { type: 'bandpass', f: 3400, Q: 2.5 }, 0.012);
  v.lfo(trickle.gain, 5.3, 0.006);
  v.lfo(trickle.gain, 8.7, 0.004);
  v.pattern(0.5, (t) => {
    tone(ctx, v.out, { t0: t, dur: 0.07, f: v.rng.range(900, 1800), f1: v.rng.range(1800, 3200), gain: 0.012 });
    return v.rng.range(0.25, 1.1);
  });
  // distant birds
  const far = filter(ctx, 'lowpass', 4500, 0.7);
  far.connect(v.out);
  addBirdChorus(v, far, ['thrush', 'blackbird', 'cuckoo', 'warbler', 'robin'], { gain: 0.03, gapMin: 2.5, gapMax: 7 });
  return v;
}

export function gardenBed(ctx: BaseAudioContext, seed: number): Voice {
  const v = new Voice(ctx, seed);
  // many bird species, two overlapping chorus patterns
  const near = filter(ctx, 'lowpass', 7000, 0.7);
  near.connect(v.out);
  addBirdChorus(v, near, ['warbler', 'thrush', 'finch', 'robin', 'blackbird', 'hoopoe', 'woodpecker'], { gain: 0.035, gapMin: 0.8, gapMax: 3 });
  addBirdChorus(v, near, ['finch', 'robin', 'warbler', 'duck'], { gain: 0.025, gapMin: 1.2, gapMax: 4, delay: 0.7 });
  // water: light flow plus random splashes
  const flow = v.noise('white', { type: 'bandpass', f: 2200, Q: 1.2 }, 0.012);
  v.lfo(flow.gain, 0.6, 0.005);
  v.pattern(0.3, (t) => {
    burst(ctx, v.out, v.rng, { t0: t, dur: v.rng.range(0.15, 0.4), kind: 'white', a: 0.02, r: 0.12, gain: v.rng.range(0.02, 0.045), filter: { type: 'bandpass', f: v.rng.range(1200, 2600), Q: 0.9 } });
    return v.rng.range(0.4, 1.6);
  });
  // soft breeze
  const breeze = v.noise('pink', { type: 'bandpass', f: 900, Q: 0.5 }, 0.025);
  v.lfo(breeze.filter.frequency, 0.07, 400);
  return v;
}

export function hellBed(ctx: BaseAudioContext, seed: number): Voice {
  const v = new Voice(ctx, seed);
  // rumble: the only low layer, breathing slowly
  const rumble = v.noise('brown', { type: 'lowpass', f: 110, Q: 0.8 }, 0.2);
  v.lfo(rumble.gain, 0.13, 0.07);
  v.lfo(rumble.filter.frequency, 0.05, 40);
  // fire roar with flutter, and crackle clicks in clusters
  const roar = v.noise('brown', { type: 'bandpass', f: 420, Q: 0.8 }, 0.05);
  v.lfo(roar.gain, 11, 0.015);
  v.lfo(roar.filter.frequency, 0.3, 120);
  v.pattern(0.2, (t) => {
    const n = v.rng.int(1, 4);
    for (let i = 0; i < n; i++) burst(ctx, v.out, v.rng, { t0: t + i * v.rng.range(0.02, 0.07), dur: 0.03, tau: 0.004, gain: v.rng.range(0.03, 0.07), filter: { type: 'highpass', f: 2500, Q: 0.7 } });
    return v.rng.range(0.08, 0.6);
  });
  // wind howl: narrow bandpass sweeping
  const howl = v.noise('pink', { type: 'bandpass', f: 500, Q: 9 }, 0.05);
  v.lfo(howl.filter.frequency, 0.05, 260);
  v.lfo(howl.filter.frequency, 0.21, 90);
  v.lfo(howl.gain, 0.17, 0.025);
  // distant thunder / explosions
  v.pattern(3, (t) => {
    const dur = v.rng.range(1.5, 3);
    burst(ctx, v.out, v.rng, { t0: t, dur, kind: 'brown', tau: dur * 0.3, a: 0.02, gain: 0.35, filter: { type: 'lowpass', f: v.rng.range(120, 260), Q: 1 } });
    tone(ctx, v.out, { t0: t, dur: 0.6, f: 48, f1: 30, gain: 0.25, a: 0.01 });
    return v.rng.range(7, 18);
  });
  // a distant bell: few partials, dull, far apart, never on a beat
  const farBell = filter(ctx, 'lowpass', 900, 0.7);
  farBell.connect(v.out);
  v.pattern(4, (t) => {
    clang(ctx, farBell, { t0: t, f: v.rng.pick([98, 110]), gain: 0.05, dur: 5, ratios: BELL_RATIOS.slice(0, 4) });
    if (v.rng.chance(0.4)) clang(ctx, farBell, { t0: t + v.rng.range(1.6, 2.6), f: 98, gain: 0.035, dur: 4, ratios: BELL_RATIOS.slice(0, 4) });
    return v.rng.range(12, 28);
  });
  // stray clangs
  v.pattern(1, (t) => {
    clang(ctx, v.out, { t0: t, f: v.rng.range(280, 900), gain: 0.035, dur: 0.9, rng: v.rng, strike: true });
    return v.rng.range(2.5, 8);
  });
  return v;
}

// Output trims, tuned from the offline test's raw columns (beds sit lower than voices).
const BED_TRIM: Record<PanelId, number> = { eden: 2.2, garden: 2.5, hell: 0.5 };
const trimmed = (make: Bed, name: PanelId): Bed => (ctx, seed) => { const v = make(ctx, seed); v.out.gain.value = BED_TRIM[name]; return v; };

export const BEDS: Record<PanelId, Bed> = { eden: trimmed(edenBed, 'eden'), garden: trimmed(gardenBed, 'garden'), hell: trimmed(hellBed, 'hell') };
