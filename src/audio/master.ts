// Master chain: section buses -> compressor -> limiter -> soft clipper -> volume.
// Two synthesized convolution reverbs ("air": short and bright, "cavern": long
// and dark). Each section bus has its own dry level and send pair, which is
// how Eden sounds airy, the Garden open and Hell cavernous.

import { gainNode, makeImpulse } from './dsp.ts';
import type { PanelId } from '../scene.ts';

// A section of the mix: each panel, and the UI cues.
export type Section = PanelId | 'cue';
export interface SectionBus { bus: GainNode; level: GainNode; sendAir: GainNode; sendCavern: GainNode }
export type Master = ReturnType<typeof createMaster>;

const SECTION_SENDS: Record<Section, { air: number; cavern: number }> = {
  eden: { air: 0.32, cavern: 0.0 },
  garden: { air: 0.22, cavern: 0.07 },
  hell: { air: 0.04, cavern: 0.42 },
  cue: { air: 0.18, cavern: 0.1 },
};

export function createMaster(ctx: BaseAudioContext, destination: AudioNode = ctx.destination) {
  const input = gainNode(ctx, 0.8);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 14;
  comp.ratio.value = 3;
  comp.attack.value = 0.012;
  comp.release.value = 0.25;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;

  // Soft clipper: tanh curve whose ceiling is 0.8 (-1.9 dBFS), so even an
  // input the limiter missed cannot pass -1 dBFS. Slope at zero is ~1.25,
  // compensated by the pre-gain below.
  const clipper = ctx.createWaveShaper();
  const N = 2048;
  const curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    curve[i] = 0.8 * Math.tanh(1.55 * x);
  }
  clipper.curve = curve;
  clipper.oversample = '2x';
  const pre = gainNode(ctx, 0.8);

  const volume = gainNode(ctx, 1);
  const mute = gainNode(ctx, 1);

  input.connect(comp).connect(limiter).connect(pre).connect(clipper).connect(volume).connect(mute).connect(destination);

  const air = ctx.createConvolver();
  air.buffer = makeImpulse(ctx, { seconds: 1.6, decay: 3.2, lowpassStart: 9000, lowpassEnd: 4000, predelay: 0.012, early: 8, seed: 11 });
  const cavern = ctx.createConvolver();
  cavern.buffer = makeImpulse(ctx, { seconds: 4.5, decay: 1.1, lowpassStart: 3200, lowpassEnd: 700, predelay: 0.03, early: 5, seed: 23 });
  const airReturn = gainNode(ctx, 0.9);
  const cavernReturn = gainNode(ctx, 1.0);
  air.connect(airReturn).connect(input);
  cavern.connect(cavernReturn).connect(input);

  const sections = {} as Record<Section, SectionBus>; // every section, filled below
  for (const [name, send] of Object.entries(SECTION_SENDS) as [Section, { air: number; cavern: number }][]) {
    const bus = gainNode(ctx, 1);     // voices/beds connect here
    const level = gainNode(ctx, 1);   // crossfade weight for the section
    const sendAir = gainNode(ctx, send.air);
    const sendCavern = gainNode(ctx, send.cavern);
    bus.connect(level);
    level.connect(input);
    level.connect(sendAir).connect(air);
    level.connect(sendCavern).connect(cavern);
    sections[name] = { bus, level, sendAir, sendCavern };
  }

  return {
    input, comp, limiter, clipper, volume, mute, sections, air, cavern,
    setVolume(v: number) { volume.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.03); },
    setMuted(m: boolean) { mute.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.03); },
    dispose() { try { mute.disconnect(); } catch { /* detached */ } },
  };
}
