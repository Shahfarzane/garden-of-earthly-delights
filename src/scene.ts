// The generated data the app fetches. The scene: public/data/scene.json, written by
// tools/buildScene.ts from data/places.json and data/stories.json, positions and radii in world px.
export type PanelId = 'eden' | 'garden' | 'hell';

export interface Panel { id: PanelId; name: string; x0: number; x1: number; y0: number; y1: number }

// A story point; overview points cover a whole panel.
export interface Poi { id: string; title: string; x: number; y: number; r: number; panel: PanelId; overview: boolean; text: string }

// A positioned ambient sound zone.
export interface Poa { i: number; x: number; y: number; r: number; volume: number; panel: PanelId }

export interface Scene {
  world: { w: number; h: number };
  panels: Panel[];
  pois: Poi[];
  poas: Poa[];
}

// public/data/strokes/stats.json, written by tools/manifest.ts: exact stroke counts.
export interface StrokeStats { total: number; base: number; deep: number; exterior: number; perLevel: Record<number, number> }
