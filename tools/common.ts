// Shared constants for the offline analyzer.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the 18 Prado tiles (tile-x{0..5}-y{0..2}.jpg, 2 GB); see README for where to get them
export const SOURCE_DIR = process.env.BOSCH_TILES || path.join(ROOT, 'tiles');

// WORLD=exterior switches the whole pipeline to the closed shutters (two painted areas
// side by side, 1402 x 1700 px from the Commons photo); the default is the open triptych.
const EXTERIOR = process.env.WORLD === 'exterior';
export const WORK = EXTERIOR ? path.join(ROOT, 'work', 'exterior') : path.join(ROOT, 'work');
export const OUT = EXTERIOR ? path.join(ROOT, 'public', 'data', 'exterior') : path.join(ROOT, 'public', 'data');

// World = full source resolution (Prado / Google Earth tile set for the interior).
export const WORLD_W = EXTERIOR ? 1402 : 156547;
export const WORLD_H = EXTERIOR ? 1700 : 89116;
export const MAX_Z = EXTERIOR ? 3 : 9; // MAX_Z is 1 world px per level px
export const TILE = 256;
export const FULL_Z = EXTERIOR ? 3 : 6; // deepest level that covers the whole painting

export const SRC_COLS = [0, 29952, 59904, 89856, 119808, 149760]; // x offsets
export const SRC_ROWS = [0, 29212, 59164]; // y offsets

// A story point's hotspot at a deep level, in level px (tools/prepareDeep.ts), and the plan of
// which deep tiles to paint: work/deep-plan.json, read by paint.ts.
export interface Hotspot { id: string; title: string; x: number; y: number; r: number }
export type DeepPlan = Record<string, { circles: Hotspot[]; paint: [number, number][] }>;

export function levelScale(z: number): number { return Math.pow(2, z - MAX_Z); }
export function levelSize(z: number): { w: number; h: number } {
  const s = levelScale(z);
  return { w: Math.ceil(WORLD_W * s), h: Math.ceil(WORLD_H * s) };
}
export function levelTiles(z: number): { nx: number; ny: number } {
  const { w, h } = levelSize(z);
  return { nx: Math.ceil(w / TILE), ny: Math.ceil(h / TILE) };
}

export function targetPath(z: number, x: number, y: number): string { return path.join(WORK, 'targets', String(z), `${x}_${y}.rgb`); }
export function strokePath(z: number, x: number, y: number): string { return path.join(OUT, 'strokes', String(z), `${x}_${y}.bin`); }

export function ensureDir(p: string): void { fs.mkdirSync(p, { recursive: true }); }
