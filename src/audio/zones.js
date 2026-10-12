// Builds the spatial sound zones from scene.json.
//
// Rule: every museum POA (positioned ambient zone) becomes a zone. Its voice is
// the voice of the nearest story point (POI) in the same panel whose circle
// overlaps the POA (distance <= poi.r + poa.r), excluding the panel-wide
// overview POIs (r > 15000 px). POAs with no overlapping POI get a panel
// default chosen by vertical band (sky / middle ground / foreground).
// Every POI with a specific voice is also a zone of its own (quieter when an
// overlapping POA already carries the same voice), so no story point is silent
// and focus(poiId) always has a voice to bring forward.

const OVERVIEW_R = 15000;

export const POI_VOICE = {
  // Eden
  'The Fountain': 'fountain-owl',
  "Swan's Fraternity": 'swans',
  'The Bosch bird': 'birds-eden',
  'Exotic Animals': 'meadow-beasts',
  'The Giraffe': 'meadow-beasts',
  'Reptiles leaving the water': 'frogs-reptiles',
  'The Mountain Landscape': 'bird-flock',
  'Animals fighting': 'beasts-fighting',
  'Adam and Eve': 'birds-eden',
  'The Dragon Tree': 'birds-eden',
  'The fall of men': 'birds-eden',
  // Garden
  'Strange Architecture': 'water-trickle',
  'Figures picking apples': 'crowd-murmur',
  'Transparent Sphere': 'lovers-murmur',
  'Courtly Love': 'lovers-murmur',
  'Debauchery': 'splash-pool',
  "Fraenger's Theory": 'fountain-adultery',
  'Mermaids and Marine knights': 'mermaids',
  'Fruits': 'crowd-murmur',
  'The Gryphon': 'giant-birds',
  'Travel journal': 'crowd-murmur',
  "Bosch's City": 'birds-garden',
  'Moors': 'crowd-murmur',
  'Wild men': 'wild-men',
  'The Circuit': 'cavalcade',
  'Birds': 'giant-birds',
  // Hell
  'Key': 'key-clank',
  'Indulgence': 'sinners-groans',
  'Pact with the devil': 'sinners-groans',
  'Rot': 'rot-flies',
  'Mirror image': 'sinners-groans',
  'Wooden clogs': 'clogs-knock',
  'Body of Christ': 'clangs',
  "Horse's Skull": 'sinners-groans',
  'Music from hell': 'music-hell',
  'City on fire': 'city-fire',
  'Hostile Armies': 'armies',
  'Ice skating in hell': 'ice-skating',
  'Diabolical bird on potty chair': 'potty-bird',
  'Gambling': 'gambling',
  'Buttock song': 'buttock-song',
  'Tree man': 'tree-man',
  'Ear and Knife': 'ear-knife',
};

function panelDefault(panel, y, i) {
  if (panel === 'eden') return y < 25000 ? 'bird-flock' : y > 70000 ? 'water-trickle' : 'birds-eden';
  if (panel === 'garden') return y < 22000 ? 'birds-garden' : y > 60000 ? 'crowd-murmur' : i % 2 ? 'birds-garden' : 'crowd-murmur';
  return y < 22000 ? 'city-fire' : y > 70000 ? 'sinners-groans' : i % 2 ? 'clangs' : 'sinners-groans';
}

export function buildZones(scene) {
  const pois = scene.pois.filter((p) => p.r <= OVERVIEW_R);
  const zones = [];

  for (const poa of scene.poas) {
    let best = null, bestD = Infinity;
    for (const poi of pois) {
      if (poi.panel !== poa.panel) continue;
      const d = Math.hypot(poi.x - poa.x, poi.y - poa.y);
      if (d <= poi.r + poa.r && d - poi.r < bestD) { bestD = d - poi.r; best = poi; }
    }
    const type = best ? (POI_VOICE[best.title] || panelDefault(poa.panel, poa.y, poa.i)) : panelDefault(poa.panel, poa.y, poa.i);
    zones.push({
      id: `poa-${poa.i}`, x: poa.x, y: poa.y, r: poa.r, panel: poa.panel,
      volume: poa.volume ?? 1, type, poiId: best ? best.id : null, source: 'poa', poiTitle: best ? best.title : null,
    });
  }

  // story points whose voice is not yet represented nearby
  for (const poi of pois) {
    const type = POI_VOICE[poi.title];
    if (!type) continue;
    const covered = zones.some((z) => z.type === type && Math.hypot(z.x - poi.x, z.y - poi.y) <= z.r + poi.r);
    zones.push({
      id: `poi-${poi.id}`, x: poi.x, y: poi.y, r: Math.max(poi.r, 2500), panel: poi.panel,
      volume: covered ? 0.6 : 1, type, poiId: poi.id, source: 'poi', poiTitle: poi.title,
    });
  }
  return zones;
}
