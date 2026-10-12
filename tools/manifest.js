// Rebuild public/data/strokes/manifest.json (which deep-level tiles hold strokes) and
// stats.json (exact stroke counts, shown in the app's strokes panel). paint.js writes the
// manifest at the end of a run; this makes tiles from a run still in progress usable.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT, FULL_Z } from './common.js';
import { RECORD_BYTES } from '../src/shared/strokeModel.js';

const dir = path.join(OUT, 'strokes');
const levels = fs.readdirSync(dir).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
const manifest = { deep: {} };
const perLevel = {};
for (const z of levels) {
  const files = fs.readdirSync(path.join(dir, String(z))).filter((f) => f.endsWith('.bin'));
  let n = 0;
  const keep = [];
  for (const f of files) {
    const size = fs.statSync(path.join(dir, String(z), f)).size;
    if (size === 0 || size % RECORD_BYTES) continue;
    n += size / RECORD_BYTES;
    keep.push(f.slice(0, -4));
  }
  perLevel[z] = n;
  if (z > FULL_Z) manifest.deep[z] = keep;
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));

let exterior = 0;
const extDir = path.join(ROOT, 'public', 'data', 'exterior', 'strokes');
if (fs.existsSync(extDir)) {
  for (const z of fs.readdirSync(extDir).filter((n) => /^\d+$/.test(n))) {
    for (const f of fs.readdirSync(path.join(extDir, z)).filter((f) => f.endsWith('.bin'))) exterior += fs.statSync(path.join(extDir, z, f)).size / RECORD_BYTES;
  }
}
const base = levels.filter((z) => z <= FULL_Z).reduce((a, z) => a + perLevel[z], 0);
const deep = levels.filter((z) => z > FULL_Z).reduce((a, z) => a + perLevel[z], 0);
const stats = { total: base + deep, base, deep, exterior, perLevel };
fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(stats));
console.log(Object.entries(manifest.deep).map(([z, l]) => `z${z}: ${l.length} tiles`).join(', '));
console.log(JSON.stringify(stats));
