// Short UI sounds. Each cue is a one-shot scheduled into `dest` at time t0.

import { tone, burst, clang, pluck, filter, gainNode, envelope, Rng, BELL_RATIOS } from './dsp.ts';

// Schedules the cue at t0 into dest; returns its length in seconds.
type Cue = (ctx: BaseAudioContext, dest: AudioNode, t0: number, rng: Rng) => number;
export type CueName = keyof typeof CUES;

const CHORD = [146.83, 220, 293.66, 440]; // D A D A: open fifths

export const CUES = {
  // shutters opening: a wooden creak (resonant noise, falling) plus a slow chord bloom
  open(ctx, dest, t0, rng) {
    for (let i = 0; i < 2; i++) {
      const dur = 1.1 + i * 0.3;
      burst(ctx, dest, rng, { t0: t0 + i * 0.35, dur, kind: 'pink', a: 0.08, r: dur * 0.5, gain: 0.12, filter: { type: 'bandpass', f: 520 - i * 120, Q: 12, f1: 240 - i * 60 } });
      // stick-slip rattle inside the creak
      for (let k = 0; k < 14; k++) {
        tone(ctx, dest, { t0: t0 + i * 0.35 + k * rng.range(0.05, 0.09), dur: 0.035, f: rng.range(180, 320), type: 'square', gain: 0.012, filter: { type: 'lowpass', f: 1500 } });
      }
    }
    const pad = filter(ctx, 'lowpass', 1200, 0.7);
    pad.frequency.setValueAtTime(600, t0);
    pad.frequency.linearRampToValueAtTime(2200, t0 + 2.5);
    pad.connect(dest);
    CHORD.forEach((f, i) => {
      tone(ctx, pad, { t0: t0 + 0.4 + i * 0.12, dur: 3.6, f, type: 'triangle', gain: 0.07, a: 1.2, r: 1.6, detune: -4 });
      tone(ctx, pad, { t0: t0 + 0.4 + i * 0.12, dur: 3.6, f, type: 'triangle', gain: 0.07, a: 1.2, r: 1.6, detune: 4 });
    });
    return 4.2;
  },
  // soft chime when a story opens
  poi(ctx, dest, t0) {
    clang(ctx, dest, { t0, f: 880, gain: 0.08, dur: 1.4, ratios: BELL_RATIOS.slice(1, 5) });
    clang(ctx, dest, { t0: t0 + 0.09, f: 1320, gain: 0.05, dur: 1.2, ratios: BELL_RATIOS.slice(1, 4) });
    return 1.5;
  },
  // gentle transition swell
  tour(ctx, dest, t0) {
    const g = gainNode(ctx, 0);
    g.connect(dest);
    envelope(g.gain, t0, 1, 0.9, 2.0, 1.0);
    burst(ctx, g, new Rng(5), { t0, dur: 2.0, kind: 'pink', a: 0.8, r: 1.0, gain: 0.06, filter: { type: 'bandpass', f: 400, Q: 1.2, f1: 1800 } });
    [220, 330, 440].forEach((f, i) => tone(ctx, g, { t0, dur: 2.0, f, type: 'sine', gain: 0.06 - i * 0.012, a: 0.9, r: 1.0, detune: i % 2 ? 5 : -5 }));
    pluck(ctx, dest, { t0: t0 + 0.8, f: 440, gain: 0.05, dur: 1.5, bright: 5 });
    pluck(ctx, dest, { t0: t0 + 1.0, f: 660, gain: 0.04, dur: 1.4, bright: 5 });
    return 2.2;
  },
  // thunder over Hell, synced to the shader's lightning: a crack, then the long roll
  // arriving a beat later (sound is slower than light)
  thunder(ctx, dest, t0, rng) {
    const lag = rng.range(0.35, 1.2);
    burst(ctx, dest, rng, { t0: t0 + lag, dur: 0.35, kind: 'white', tau: 0.08, a: 0.004, gain: 0.18, filter: { type: 'bandpass', f: 1800, Q: 0.8, f1: 500 } });
    const roll = rng.range(3, 5.5);
    burst(ctx, dest, rng, { t0: t0 + lag + 0.05, dur: roll, kind: 'brown', tau: roll * 0.35, a: 0.06, gain: 0.55, filter: { type: 'lowpass', f: 420, Q: 0.9, f1: 90 } });
    tone(ctx, dest, { t0: t0 + lag + 0.05, dur: 1.4, f: 52, f1: 28, gain: 0.3, a: 0.02 });
    return lag + roll;
  },
  // card closes: a soft wooden tap and a short falling tone
  close(ctx, dest, t0, rng) {
    tone(ctx, dest, { t0, dur: 0.12, f: 240, f1: 170, type: 'sine', gain: 0.1, a: 0.002, r: 0.1 });
    burst(ctx, dest, rng, { t0, dur: 0.05, tau: 0.01, gain: 0.08, filter: { type: 'bandpass', f: 1100, Q: 2.5 } });
    tone(ctx, dest, { t0: t0 + 0.03, dur: 0.35, f: 660, f1: 440, type: 'triangle', gain: 0.03, a: 0.01, r: 0.25 });
    return 0.5;
  },
} satisfies Record<string, Cue>;

const CUE_TRIM: Record<CueName, number> = { open: 1, poi: 1.5, tour: 1.3, close: 1.8, thunder: 0.6 };

export function playCue(name: CueName, ctx: BaseAudioContext, dest: AudioNode, t0 = ctx.currentTime + 0.01, rng = new Rng(Date.now() & 0xffff), gain = 1): number {
  const c = CUES[name];
  if (!c) return 0;
  const trim = gainNode(ctx, (CUE_TRIM[name] ?? 1) * gain);
  trim.connect(dest);
  return c(ctx, trim, t0, rng);
}
