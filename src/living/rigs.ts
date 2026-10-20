// Rigs: which parts of the painted image move, where, and how much.
//
// All positions are normalized triptych coordinates: x = world x / 156547, y = world y / 89116,
// covering the whole open triptych including the gaps between panels. Measured on the level-7
// and level-8 target tiles, each checked on a preview with its region and pivot drawn on.
//
// region: an ellipse. x,y centre; rx is the semi-axis in x-units (fraction of the width), ry the
//   semi-axis in y-units (fraction of the height), measured before rotation; angle in degrees,
//   clockwise on screen, applied in world pixel space. feather: the fraction of the ellipse
//   (from the edge inwards) over which the motion fades to zero.
// kind 'rotate': rotate the region about pivot by `amount` degrees (peak), wave over `period` s.
// kind 'translate': amount {dx, dy} in x-units and y-units (peak).
// kind 'scale': scale about pivot by 1 +- amount (peak).
// kind 'eyes': paints eyeballs over the painted ones; r is the radius of the visible eye in x-units;
//   pupil is the pupil radius as a fraction of r; colours sampled from the painting around the eye.
//   blink [min, max] seconds between blinks, or null for lidless eyes. attach: id of a displacement rig on
//   the same head; the eyeballs must follow that rig's displacement or they drift off the face.
// kind 'splash': droplet bursts at points, every [min, max] seconds, size in x-units.
// wave: 'sine' | 'gallop' (bouncing |sin|) | 'saw' (slow forward, quick back) | 'pulse' (rare twitch).
// trigger: 'always' or 'near' (only while the pointer is within the region).
// priority: 1 is the showcase set (10 rigs), 2 is worth having, 3 is a small extra.

import type { PanelId } from '../scene.ts';

export type Wave = 'sine' | 'gallop' | 'saw' | 'pulse';
// An ellipse in normalized triptych units, angle in degrees.
export interface Region { x: number; y: number; rx: number; ry: number; angle?: number }
interface RigBase { id: string; title: string; panel: PanelId; priority: 1 | 2 | 3 }
interface Displacement {
  region: Region; feather?: number; pivot?: { x: number; y: number };
  period?: number; phase?: number; wave?: Wave; trigger?: 'always' | 'near';
}
export interface TurnRig extends RigBase, Displacement { kind: 'rotate' | 'scale'; amount: number }
export interface ShiftRig extends RigBase, Displacement { kind: 'translate'; amount: { dx?: number; dy?: number } }
export interface EyesRig extends RigBase {
  kind: 'eyes'; eyes: { x: number; y: number; r: number }[]; pupil: number;
  sclera?: string; pupilColor?: string; lid?: string; follow?: 'pointer'; blink: [number, number] | null; glow?: boolean; attach?: string;
}
export interface SplashRig extends RigBase { kind: 'splash'; points: { x: number; y: number }[]; every?: [number, number]; size?: number }
export interface GlowRig extends RigBase { kind: 'glow'; x: number; y: number; r: number; color?: string; flicker?: number }
// Warps move the painted image in the post shader; overlays are drawn on the living layer.
export type WarpRig = TurnRig | ShiftRig;
export type OverlayRig = EyesRig | SplashRig | GlowRig;
export type Rig = WarpRig | OverlayRig;

export const RIGS: Rig[] = [
  // ---------------------------------------------------------------- Eden
  { id: 'eden-elephant-ear', title: 'The elephant flaps its ear', panel: 'eden', priority: 2,
    kind: 'rotate', region: { x: 0.0884, y: 0.2961, rx: 0.0042, ry: 0.0123, angle: -10 }, feather: 0.35,
    pivot: { x: 0.0914, y: 0.2890 }, amount: 2.5, period: 7, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'eden-elephant-trunk', title: 'The elephant curls its trunk', panel: 'eden', priority: 2,
    kind: 'rotate', region: { x: 0.1014, y: 0.3143, rx: 0.0035, ry: 0.0070, angle: 0 }, feather: 0.4,
    pivot: { x: 0.0966, y: 0.3060 }, amount: 2, period: 9, phase: 2.5, wave: 'sine', trigger: 'always' },
  { id: 'eden-giraffe-head', title: 'The giraffe turns its head', panel: 'eden', priority: 2,
    kind: 'rotate', region: { x: 0.1785, y: 0.2979, rx: 0.0048, ry: 0.0142, angle: 15 }, feather: 0.35,
    pivot: { x: 0.1810, y: 0.3095 }, amount: 2, period: 10, phase: 1, wave: 'sine', trigger: 'always' },
  { id: 'eden-unicorn-drinks', title: 'The unicorn dips its head to drink', panel: 'eden', priority: 2,
    kind: 'rotate', region: { x: 0.0384, y: 0.3830, rx: 0.0092, ry: 0.0063, angle: -63 }, feather: 0.35,
    pivot: { x: 0.0424, y: 0.3710 }, amount: 3, period: 8, phase: 3, wave: 'sine', trigger: 'always' },
  { id: 'eden-fountain-owl-eyes', title: 'The owl in the fountain watches you', panel: 'eden', priority: 2,
    kind: 'eyes', eyes: [{ x: 0.11894, y: 0.48794, r: 0.00041 }, { x: 0.12042, y: 0.48758, r: 0.00041 }], pupil: 0.55,
    sclera: '#b8b864', pupilColor: '#2b2118', lid: '#372d25', follow: 'pointer', blink: [4, 10], glow: true },
  { id: 'eden-eve-hair-right', title: "Eve's hair stirs", panel: 'eden', priority: 1,
    kind: 'rotate', region: { x: 0.18555, y: 0.7123, rx: 0.00245, ry: 0.0277, angle: 0 }, feather: 0.45,
    pivot: { x: 0.1782, y: 0.6674 }, amount: 1.2, period: 6, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'eden-eve-hair-left', title: "Eve's hair stirs (left fall)", panel: 'eden', priority: 2,
    kind: 'rotate', region: { x: 0.16665, y: 0.7234, rx: 0.0021, ry: 0.0166, angle: 0 }, feather: 0.45,
    pivot: { x: 0.1782, y: 0.6674 }, amount: 1.0, period: 6, phase: 1.8, wave: 'sine', trigger: 'always' },
  { id: 'eden-rabbit-ears', title: 'The rabbit twitches its ears', panel: 'eden', priority: 3,
    kind: 'rotate', region: { x: 0.19776, y: 0.75748, rx: 0.00166, ry: 0.00336, angle: 0 }, feather: 0.4,
    pivot: { x: 0.19776, y: 0.76061 }, amount: 4, period: 9, phase: 0, wave: 'pulse', trigger: 'always' },
  { id: 'eden-cat-tail', title: 'The cat with the mouse swings its tail', panel: 'eden', priority: 2,
    kind: 'rotate', region: { x: 0.0498, y: 0.8240, rx: 0.0068, ry: 0.0035, angle: -35 }, feather: 0.4,
    pivot: { x: 0.0442, y: 0.8317 }, amount: 3, period: 4, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'eden-swan-neck', title: 'The swan dips its neck', panel: 'eden', priority: 2,
    kind: 'rotate', region: { x: 0.17724, y: 0.47211, rx: 0.00153, ry: 0.00583, angle: 0 }, feather: 0.4,
    pivot: { x: 0.17699, y: 0.47749 }, amount: 3, period: 6, phase: 2, wave: 'sine', trigger: 'always' },
  { id: 'eden-boar-roots', title: 'The boar roots in the grass', panel: 'eden', priority: 3,
    kind: 'rotate', region: { x: 0.20715, y: 0.26294, rx: 0.00358, ry: 0.00717, angle: 0 }, feather: 0.4,
    pivot: { x: 0.21021, y: 0.26294 }, amount: 2, period: 3, phase: 0, wave: 'gallop', trigger: 'always' },

  // ---------------------------------------------------------------- Garden
  // Pool of Youth: bathers at the waterline bob, swimmers splash
  { id: 'garden-pool-splash', title: 'The Pool of Youth: splashing', panel: 'garden', priority: 1,
    kind: 'splash', points: [{ x: 0.51917, y: 0.42207 }, { x: 0.53108, y: 0.42046 }, { x: 0.51367, y: 0.44057 },
      { x: 0.47150, y: 0.43896 }, { x: 0.5375, y: 0.4518 }], every: [1.5, 4], size: 0.003 },
  { id: 'garden-pool-swimmers', title: 'The Pool of Youth: two swimmers splashing', panel: 'garden', priority: 1,
    kind: 'translate', region: { x: 0.52558, y: 0.42931, rx: 0.0069, ry: 0.0088, angle: 0 }, feather: 0.45,
    amount: { dx: 0.0003, dy: 0.0012 }, period: 2.8, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'garden-pool-bather-right', title: 'The Pool of Youth: half-submerged bather bobs', panel: 'garden', priority: 2,
    kind: 'translate', region: { x: 0.52329, y: 0.45103, rx: 0.0050, ry: 0.0080, angle: 0 }, feather: 0.45,
    amount: { dx: 0, dy: 0.0006 }, period: 3.4, phase: 1.1, wave: 'sine', trigger: 'always' },
  { id: 'garden-pool-black-swimmer', title: 'The Pool of Youth: the black swimmer bobs', panel: 'garden', priority: 2,
    kind: 'translate', region: { x: 0.51321, y: 0.44298, rx: 0.0041, ry: 0.0048, angle: 0 }, feather: 0.45,
    amount: { dx: 0.0002, dy: 0.0008 }, period: 2.4, phase: 0.7, wave: 'sine', trigger: 'always' },
  { id: 'garden-pool-bather-left', title: 'The Pool of Youth: bather at the left edge bobs', panel: 'garden', priority: 2,
    kind: 'translate', region: { x: 0.46279, y: 0.44942, rx: 0.0046, ry: 0.0088, angle: 0 }, feather: 0.45,
    amount: { dx: 0, dy: 0.0008 }, period: 3.1, phase: 2.2, wave: 'sine', trigger: 'always' },
  { id: 'garden-pool-dark-bather', title: 'The Pool of Youth: dark bather bobs', panel: 'garden', priority: 2,
    kind: 'translate', region: { x: 0.47013, y: 0.43976, rx: 0.0028, ry: 0.0056, angle: 0 }, feather: 0.45,
    amount: { dx: 0, dy: 0.0007 }, period: 2.6, phase: 1.6, wave: 'sine', trigger: 'always' },
  { id: 'garden-sphere-lovers', title: 'The lovers in the glass sphere breathe', panel: 'garden', priority: 1,
    kind: 'scale', region: { x: 0.3185, y: 0.67897, rx: 0.00825, ry: 0.0212, angle: 0 }, feather: 0.45,
    pivot: { x: 0.3185, y: 0.70408 }, amount: 0.015, period: 5, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'garden-mussel-opens', title: 'The mussel shell opens a crack', panel: 'garden', priority: 1,
    kind: 'rotate', region: { x: 0.40613, y: 0.70074, rx: 0.0298, ry: 0.0192, angle: 0 }, feather: 0.4,
    pivot: { x: 0.37813, y: 0.71764 }, amount: -1.2, period: 10, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'garden-owl-held-eyes', title: 'The little owl on the arm watches you', panel: 'garden', priority: 2,
    kind: 'eyes', eyes: [{ x: 0.7061, y: 0.61884, r: 0.0014 }, { x: 0.71195, y: 0.61865, r: 0.0014 }], pupil: 0.6,
    sclera: '#9a9056', pupilColor: '#12130b', lid: '#514e2c', follow: 'pointer', blink: [3, 8], glow: false },
  { id: 'garden-owl-eyes', title: 'The great owl watches you', panel: 'garden', priority: 1,
    kind: 'eyes', eyes: [{ x: 0.2546, y: 0.64002, r: 0.0027 }, { x: 0.2627, y: 0.63976, r: 0.0024 }], pupil: 0.85,
    sclera: '#1a170c', pupilColor: '#040403', lid: '#5a4f2e', follow: 'pointer', blink: [4, 9], glow: false },
  { id: 'garden-kingfisher-head', title: 'The giant kingfisher turns its head', panel: 'garden', priority: 2,
    kind: 'rotate', region: { x: 0.29136, y: 0.54485, rx: 0.0161, ry: 0.0110, angle: 0 }, feather: 0.4,
    pivot: { x: 0.27938, y: 0.56041 }, amount: 2, period: 7, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'garden-goldfinch-head', title: 'The giant goldfinch turns its head', panel: 'garden', priority: 2,
    kind: 'rotate', region: { x: 0.34917, y: 0.55492, rx: 0.0141, ry: 0.0128, angle: 0 }, feather: 0.4,
    pivot: { x: 0.34188, y: 0.57323 }, amount: 2.5, period: 6, phase: 2, wave: 'sine', trigger: 'always' },
  { id: 'garden-mallard-head', title: 'The giant mallard nods', panel: 'garden', priority: 2,
    kind: 'rotate', region: { x: 0.33042, y: 0.61900, rx: 0.0135, ry: 0.0092, angle: 0 }, feather: 0.4,
    pivot: { x: 0.31792, y: 0.61716 }, amount: 2, period: 8, phase: 4, wave: 'sine', trigger: 'always' },
  { id: 'garden-tit-head', title: 'The great tit flicks its head', panel: 'garden', priority: 2,
    kind: 'rotate', region: { x: 0.46888, y: 0.68836, rx: 0.0042, ry: 0.0087, angle: 0 }, feather: 0.4,
    pivot: { x: 0.4647, y: 0.69169 }, amount: 2.5, period: 5, phase: 0, wave: 'pulse', trigger: 'always' },
  { id: 'garden-griffin-flies', title: 'The griffin and its rider bob in the air', panel: 'garden', priority: 2,
    kind: 'translate', region: { x: 0.289, y: 0.0931, rx: 0.0168, ry: 0.0176, angle: 0 }, feather: 0.45,
    amount: { dx: 0.0002, dy: 0.0015 }, period: 4, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'garden-fishrider-flies', title: 'The flying fish and its rider bob', panel: 'garden', priority: 2,
    kind: 'translate', region: { x: 0.38425, y: 0.07765, rx: 0.0158, ry: 0.0237, angle: 0 }, feather: 0.45,
    amount: { dx: 0.0002, dy: 0.0012 }, period: 5, phase: 1.5, wave: 'sine', trigger: 'always' },
  { id: 'garden-winged-figure-flies', title: 'The winged figure with the fruit bobs', panel: 'garden', priority: 2,
    kind: 'translate', region: { x: 0.7066, y: 0.0816, rx: 0.0114, ry: 0.0237, angle: 0 }, feather: 0.45,
    amount: { dx: 0.0001, dy: 0.0012 }, period: 4.2, phase: 3, wave: 'sine', trigger: 'always' },
  { id: 'garden-bluefish-flies', title: 'The blue flying fish and its rider bob', panel: 'garden', priority: 2,
    kind: 'translate', region: { x: 0.7325, y: 0.12076, rx: 0.0112, ry: 0.0246, angle: 0 }, feather: 0.45,
    amount: { dx: 0.0004, dy: 0.0012 }, period: 4.5, phase: 2.4, wave: 'sine', trigger: 'always' },
  { id: 'garden-fish-carried-eye', title: 'The carried fish looks at you', panel: 'garden', priority: 2,
    kind: 'eyes', eyes: [{ x: 0.55543, y: 0.70776, r: 0.00135 }], pupil: 0.6,
    sclera: '#646042', pupilColor: '#232215', lid: '#4f4c2d', follow: 'pointer', blink: null, glow: false },
  { id: 'garden-fish-bottom-eye', title: 'The fish at the bottom looks at you', panel: 'garden', priority: 2,
    kind: 'eyes', eyes: [{ x: 0.4402, y: 0.94187, r: 0.0022 }], pupil: 0.7,
    sclera: '#89896e', pupilColor: '#2a2e2a', lid: '#6d5d3b', follow: 'pointer', blink: null, glow: false },
  { id: 'garden-thrush-eye', title: 'The big brown bird looks at you', panel: 'garden', priority: 2,
    kind: 'eyes', eyes: [{ x: 0.52664, y: 0.59257, r: 0.00105 }], pupil: 0.55,
    sclera: '#5a7fa8', pupilColor: '#1d2219', lid: '#ac9f74', follow: 'pointer', blink: [4, 9], glow: false },

  // ---------------------------------------------------------------- Hell
  { id: 'hell-treeman-eyes', title: 'The Tree Man follows you with his eyes', panel: 'hell', priority: 1,
    kind: 'eyes', eyes: [{ x: 0.89883, y: 0.37405, r: 0.00083 }, { x: 0.9055, y: 0.37376, r: 0.00083 }], pupil: 0.5, attach: 'hell-treeman-head',
    sclera: '#a69d84', pupilColor: '#3e3428', lid: '#83755b', follow: 'pointer', blink: [3, 8], glow: false },
  { id: 'hell-treeman-head', title: 'The Tree Man turns his head a little', panel: 'hell', priority: 3,
    kind: 'rotate', region: { x: 0.90367, y: 0.38341, rx: 0.0077, ry: 0.0152, angle: 0 }, feather: 0.45,
    pivot: { x: 0.90367, y: 0.39746 }, amount: 1.2, period: 11, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'hell-knife-saws', title: 'The knife between the ears saws', panel: 'hell', priority: 1,
    kind: 'translate', region: { x: 0.853, y: 0.2895, rx: 0.0206, ry: 0.0129, angle: -29.5 }, feather: 0.3,
    amount: { dx: 0.00145, dy: -0.00143 }, period: 3, phase: 0, wave: 'saw', trigger: 'always' },
  { id: 'hell-prince-eye', title: 'The Prince of Hell eyes you', panel: 'hell', priority: 2,
    kind: 'eyes', eyes: [{ x: 0.95145, y: 0.63686, r: 0.0023 }], pupil: 0.85, attach: 'hell-prince-gulps',
    sclera: '#2b2419', pupilColor: '#14110c', lid: '#a89775', follow: 'pointer', blink: [3, 7], glow: true },
  { id: 'hell-prince-gulps', title: 'The Prince of Hell gulps down a sinner', panel: 'hell', priority: 1,
    kind: 'rotate', region: { x: 0.950, y: 0.63864, rx: 0.0105, ry: 0.0105, angle: 0 }, feather: 0.4,
    pivot: { x: 0.956, y: 0.64918 }, amount: 2.5, period: 4, phase: 0, wave: 'gallop', trigger: 'always' },
  { id: 'hell-skater-wobbles', title: 'The skater wobbles on the ice', panel: 'hell', priority: 1,
    kind: 'rotate', region: { x: 0.96015, y: 0.58111, rx: 0.0086, ry: 0.0142, angle: 0 }, feather: 0.4,
    pivot: { x: 0.95925, y: 0.59534 }, amount: 2, period: 3.5, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'hell-harp-strings', title: "The harp's strings shiver", panel: 'hell', priority: 2,
    kind: 'translate', region: { x: 0.819, y: 0.5996, rx: 0.012, ry: 0.037, angle: -12 }, feather: 0.35,
    amount: { dx: 0.00015, dy: 0 }, period: 2, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'hell-hare-eye', title: 'The hare with the horn looks at you', panel: 'hell', priority: 2,
    kind: 'eyes', eyes: [{ x: 0.86303, y: 0.77215, r: 0.0016 }], pupil: 0.55,
    sclera: '#a79e82', pupilColor: '#241408', lid: '#4f3d16', follow: 'pointer', blink: [3, 8], glow: false },
  { id: 'hell-pignun-nuzzles', title: 'The pig in the nun\'s veil nuzzles', panel: 'hell', priority: 2,
    kind: 'rotate', region: { x: 0.9638, y: 0.88301, rx: 0.0072, ry: 0.0091, angle: 0 }, feather: 0.4,
    pivot: { x: 0.9714, y: 0.89214 }, amount: 2, period: 5, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'hell-bagpipe-breathes', title: 'The bagpipe on the hat breathes', panel: 'hell', priority: 2,
    kind: 'scale', region: { x: 0.8945, y: 0.31214, rx: 0.0125, ry: 0.0229, angle: 0 }, feather: 0.4,
    pivot: { x: 0.8945, y: 0.31214 }, amount: 0.02, period: 4, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'hell-hurdy-wheel', title: 'The hurdy-gurdy wheel rocks', panel: 'hell', priority: 3,
    kind: 'rotate', region: { x: 0.8581, y: 0.73169, rx: 0.01015, ry: 0.0178, angle: 0 }, feather: 0.25,
    pivot: { x: 0.8581, y: 0.73169 }, amount: 3, period: 6, phase: 0, wave: 'sine', trigger: 'always' },
  { id: 'hell-toad-breathes', title: 'The toad on her breast breathes', panel: 'hell', priority: 3,
    kind: 'scale', region: { x: 0.9274, y: 0.77738, rx: 0.00175, ry: 0.0034, angle: 0 }, feather: 0.4,
    pivot: { x: 0.9274, y: 0.77738 }, amount: 0.04, period: 2.5, phase: 0, wave: 'sine', trigger: 'always' },
];
