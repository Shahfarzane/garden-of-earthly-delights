// Offline render test: every voice type and bed in both modes, plus every cue,
// rendered through the real master chain in an OfflineAudioContext and
// measured for peak and RMS. 'nature' renders also assert that no music
// generator was instantiated (music.js counts them). Used by dev/audio.html.

import { createMaster } from './master.js';
import { BEDS } from './beds.js';
import { MUSIC_BEDS, musicStats } from './music.js';
import { createVoice, VOICE_NAMES, VOICE_PANEL } from './voices.js';
import { CUES, playCue } from './cues.js';
import { dB } from './dsp.js';

export function testItems() {
  const items = [];
  for (const mode of ['nature', 'period']) {
    for (const name of VOICE_NAMES) items.push({ kind: 'voice', name, mode, seconds: 4 });
    for (const name of Object.keys(BEDS)) items.push({ kind: 'bed', name, mode, seconds: mode === 'period' ? 8 : 4 });
  }
  for (const name of Object.keys(CUES)) items.push({ kind: 'cue', name, mode: '-', seconds: 4 });
  return items;
}

function measure(buffer) {
  let peak = 0, sum = 0, nan = false, n = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (x !== x) { nan = true; continue; }
      const ax = Math.abs(x);
      if (ax > peak) peak = ax;
      sum += x * x;
      n++;
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, n)), nan };
}

// raw=true bypasses the master chain so the source level itself can be read.
async function renderOnce(item, sampleRate, raw) {
  const seconds = item.seconds;
  const ctx = new OfflineAudioContext(2, Math.floor(seconds * sampleRate), sampleRate);
  const master = raw ? null : createMaster(ctx);
  const dest = (section) => (raw ? ctx.destination : master.sections[section].bus);
  const music = item.mode === 'period';
  const before = musicStats.instantiated;
  const voices = [];
  if (item.kind === 'voice') {
    const v = createVoice(item.name, ctx, 1, { music });
    v.out.connect(dest(VOICE_PANEL[item.name]));
    voices.push(v);
  } else if (item.kind === 'bed') {
    // the period bed is the nature bed plus the consort, as the Soundscape mixes them
    const v = BEDS[item.name](ctx, 2);
    v.out.connect(dest(item.name));
    voices.push(v);
    if (music) {
      const m = MUSIC_BEDS[item.name](ctx, 3);
      const g = ctx.createGain();
      g.gain.value = 0.55; // musicMaster at the overview
      m.out.connect(g).connect(dest(item.name));
      voices.push(m);
    }
  } else {
    playCue(item.name, ctx, dest('cue'), 0.05);
  }
  const musicBuilt = musicStats.instantiated - before;
  // advance patterns in lookahead-sized steps, as the live update loop does
  for (let t = 0.5; t <= seconds + 0.5; t += 0.5) for (const v of voices) v.schedule(t);
  const buffer = await ctx.startRendering();
  for (const v of voices) v.dispose();
  return { ...measure(buffer), musicBuilt };
}

export async function renderItem(item, { sampleRate = 44100 } = {}) {
  const m = await renderOnce(item, sampleRate, false);
  const r = await renderOnce(item, sampleRate, true);
  const peakDb = dB(m.peak), rmsDb = dB(m.rms);
  const natureClean = item.mode !== 'nature' || m.musicBuilt === 0;
  return {
    kind: item.kind, name: item.name, mode: item.mode, seconds: item.seconds,
    peakDb: +peakDb.toFixed(1), rmsDb: +rmsDb.toFixed(1),
    rawPeakDb: +dB(r.peak).toFixed(1), rawRmsDb: +dB(r.rms).toFixed(1),
    musicBuilt: m.musicBuilt, nan: m.nan || r.nan,
    pass: !m.nan && !r.nan && rmsDb > -60 && peakDb < -1 && natureClean,
  };
}

export async function runOfflineTest(opts = {}) {
  const rows = [];
  const items = testItems();
  for (const item of items) {
    const row = await renderItem(item, opts);
    rows.push(row);
    if (opts.onRow) opts.onRow(row, rows.length, items.length);
  }
  return rows;
}
