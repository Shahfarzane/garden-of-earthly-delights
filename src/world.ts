// World geometry. 1 world unit = 1 pixel of the 156,547 px Prado source scan.
export const WORLD_W = 156547;
export const WORLD_H = 89116;
export const MAX_Z = 9;
export const TILE = 256;
export const FULL_Z = 6; // stroke data covers the whole painting up to this level
export const GROUND: readonly [number, number, number] = [214, 200, 168]; // chalk ground, matches tools/paintTile.ts

// A rect, in world px or screen px.
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export type Vec2 = [number, number];

export function levelSize(z: number): { w: number; h: number } {
  const s = Math.pow(2, z - MAX_Z);
  return { w: Math.ceil(WORLD_W * s), h: Math.ceil(WORLD_H * s) };
}
export function levelTiles(z: number): { nx: number; ny: number } {
  const { w, h } = levelSize(z);
  return { nx: Math.ceil(w / TILE), ny: Math.ceil(h / TILE) };
}
