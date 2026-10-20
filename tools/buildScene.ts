// Build public/data/scene.json from data/places.json (where each story and sound zone sits)
// and data/stories.json (the story titles and texts, original writing).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT, ensureDir, WORLD_W, WORLD_H } from './common.ts';
import type { Panel, Poi, Poa, Scene } from '../src/scene.ts';

// data/places.json: normalized positions; data/stories.json: the texts.
interface Places {
  stories: { id: string; x: number; y: number; r: number; overview?: boolean }[];
  soundZones: { x: number; y: number; r: number; volume?: number }[];
}
interface StoryText { id: string; title: string; text: string }

// Positions are normalized to the whole triptych (x and y both 0..1); r is a fraction of its width.
const places: Places = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'places.json'), 'utf8'));

// Panel rects in world px, measured from the scan's black gaps (tools: see docs/plan.md).
const panels: Panel[] = [
  { id: 'eden', name: 'The Garden of Eden', x0: 992, x1: 36640, y0: 992, y1: 88128 },
  { id: 'garden', name: 'The Garden of Earthly Delights', x0: 37600, x1: 118944, y0: 992, y1: 88128 },
  { id: 'hell', name: 'Hell', x0: 119904, x1: 155552, y0: 992, y1: 88128 },
];
const panelOf = (wx: number) => (wx < 37120 ? 'eden' : wx < 119424 ? 'garden' : 'hell');

const storiesPath = path.join(ROOT, 'data', 'stories.json');
if (!fs.existsSync(storiesPath)) throw new Error('data/stories.json is missing: story text must come from it');
const stories = new Map<string, StoryText>(JSON.parse(fs.readFileSync(storiesPath, 'utf8')).map((s: StoryText) => [s.id, s]));
const pois = places.stories.map((p): Poi => {
  const story = stories.get(p.id);
  if (!story || !story.text?.trim()) throw new Error(`no text for story ${p.id} in data/stories.json`);
  return {
    id: p.id,
    title: story.title.trim(),
    x: p.x * WORLD_W, y: p.y * WORLD_H, r: p.r * WORLD_W,
    panel: panelOf(p.x * WORLD_W),
    overview: !!p.overview,
    text: story.text.replace(/\r/g, '').trim(),
  };
});
const poas = places.soundZones.map((a, i): Poa => ({
  i, x: a.x * WORLD_W, y: a.y * WORLD_H, r: a.r * WORLD_W, volume: a.volume ?? 1, panel: panelOf(a.x * WORLD_W),
}));
ensureDir(OUT);
fs.writeFileSync(path.join(OUT, 'scene.json'), JSON.stringify({ world: { w: WORLD_W, h: WORLD_H }, panels, pois, poas } satisfies Scene, null, 1));
console.log(`pois ${pois.length}, poas ${poas.length}`);
