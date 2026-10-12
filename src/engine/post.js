// Post pass: brings the painted scene to life (water, fire, foliage, sky, animated figures),
// ages it (craquelure, varnish), and paints the frames, hinges and the dark board around it.
import { createProgram } from './gl.js';
import { WORLD_W, WORLD_H } from '../world.js';

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;
void main() { gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_fx;
uniform vec2 u_view;       // physical px
uniform vec3 u_cam;        // cx, cy (world), k = physical px per world px
uniform float u_time;
uniform float u_age;       // craquelure + varnish amount 0..1
uniform float u_life;      // animation amount 0..1
uniform float u_flash;     // hell lightning 0..1
uniform vec4 u_panels[3];  // x0, y0, x1, y1 world
uniform vec2 u_world;
uniform vec2 u_pointer;    // world px of the pointer (raking light)
uniform float u_rake;      // raking light strength
uniform vec4 u_bobs[8];    // painted creatures that bob on water: x, y, radius, amplitude (world px)
uniform vec4 u_ring;       // cavalcade: centre x, y, outer rx, ry (world px)
uniform vec2 u_ringIn;     // pool inside the cavalcade: rx, ry
uniform vec3 u_deep[48];   // story-point hotspots painted from the full-resolution scan (real cracks)
uniform float u_deepOn;    // 1 when the view is at a level that shows those deep strokes
uniform float u_hideWings; // 1 while the shutters are closed: the wings are not on the board
// Animated figures (src/living/rigs.js): up to 16 active rigs, motion evaluated on the CPU.
uniform vec4 u_rigA[16];   // region centre x, y, radii rx, ry (world px)
uniform vec4 u_rigB[16];   // cos, sin of region angle, feather, kind (1 rotate, 2 translate, 3 scale)
uniform vec4 u_rigC[16];   // pivot x, y, motion a, b (rotate: radians; translate: dx, dy world px; scale: factor)
uniform int u_rigN;
out vec4 o;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

// Voronoi edge distance (F2 - F1) for craquelure, in cell units.
float cracks(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 r = g + vec2(hash(i + g), hash(i + g + 7.7)) * 0.9 + 0.05 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}

// Rounded frame profile: height and slope across the frame (t = 0 inner edge .. 1 outer edge).
float profileH(float t) {
  float bead = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.06, 0.11, t)) * 0.35;
  float cove = 0.25 + 0.55 * smoothstep(0.1, 0.42, t);
  float edge = 1.0 - smoothstep(0.82, 1.0, t);
  return (bead + cove * edge) ;
}

// The board: near-black, with a dot grid whose spacing adapts to the zoom like a design canvas.
float dots(vec2 w, float spacing, float k) {
  vec2 g = (fract(w / spacing + 0.5) - 0.5) * spacing * k; // screen px from the nearest dot
  return smoothstep(1.5, 0.5, length(g));
}
vec3 board(vec2 w, float k) {
  // pure black, like klim.co.nz, with a faint #1c1c1c dot grid that adapts to the zoom
  vec3 col = vec3(0.0);
  float target = 30.0 / k;                                 // ~30 screen px between dots
  float lg = log2(target);
  float s0 = exp2(ceil(lg));
  float fine = 1.0 - fract(lg);                            // fades the finer grid in as you zoom
  col += vec3(0.11) * dots(w, s0, k);
  col += vec3(0.11) * fine * dots(w, s0 * 0.5, k) * 0.6;
  return col;
}

vec3 frame(vec2 w, vec4 R, float FW, out float a) {
  // signed distance outside the panel rect
  vec2 q = max(vec2(R.x - w.x, R.y - w.y), vec2(w.x - R.z, w.y - R.w));
  float d = max(q.x, q.y);
  a = 0.0;
  if (d < 0.0 || d > FW) return vec3(0.0);
  a = 1.0;
  float t = d / FW;
  // which side: compare normalized distances (mitred corners)
  bool vertical = q.x > q.y; // left/right sides
  vec2 outward = vertical ? vec2(w.x < R.x ? -1.0 : 1.0, 0.0) : vec2(0.0, w.y < R.y ? -1.0 : 1.0);
  float e = 0.004;
  float slope = (profileH(t + e) - profileH(t - e)) / (2.0 * e);
  vec3 n = normalize(vec3(-outward * slope * 0.9, 1.0));
  vec3 L = normalize(vec3(-0.45, -0.6, 0.66));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0, 0, 1)), 0.0, 1.0), 24.0);
  // oak grain along the member
  vec2 g = vertical ? w.yx : w;
  float grain = fbm(vec2(g.x / 2600.0, g.y / 90.0)) * 0.6 + fbm(vec2(g.x / 400.0, g.y / 22.0)) * 0.25;
  float rings = sin(g.y / 55.0 + fbm(g / 900.0) * 9.0) * 0.5 + 0.5;
  vec3 oak = mix(vec3(0.16, 0.095, 0.05), vec3(0.3, 0.19, 0.1), grain) * (0.85 + 0.15 * rings);
  float gilt = smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.075, 0.1, t));
  vec3 gold = mix(vec3(0.42, 0.3, 0.12), vec3(0.85, 0.68, 0.36), fbm(w / 300.0));
  vec3 base = mix(oak, gold, gilt);
  vec3 col = base * (0.35 + 0.85 * diff) + spec * mix(0.06, 0.5, gilt);
  // mitre seam
  float seam = abs(q.x - q.y) / FW;
  col *= mix(0.6, 1.0, smoothstep(0.0, 0.004, seam));
  // inner shadow line where frame meets the panel
  col *= mix(0.45, 1.0, smoothstep(0.0, 0.02, t));
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 sp = vec2(frag.x, u_view.y - frag.y);                  // screen px, y down
  vec2 w = u_cam.xy + (sp - u_view * 0.5) / u_cam.z;         // world px
  float k = u_cam.z;

  // which panel
  int pi = -1;
  for (int i = 0; i < 3; i++) { vec4 R = u_panels[i]; if (w.x >= R.x && w.x <= R.z && w.y >= R.y && w.y <= R.w) pi = i; }
  bool closed = u_hideWings > 0.5;
  if (closed && pi != 1) pi = -1;

  if (pi < 0) {
    // frames (nearest panel wins between the wings), hinges, board
    vec3 col = board(w, k);
    float FW = 1500.0;
    float best = 1e9; int bi = 0;
    for (int i = 0; i < 3; i++) {
      if (closed && i != 1) continue;
      vec4 R = u_panels[i];
      vec2 q = max(vec2(R.x - w.x, R.y - w.y), vec2(w.x - R.z, w.y - R.w));
      float d = max(q.x, q.y);
      if (d < best) { best = d; bi = i; }
    }
    // drop shadow of the triptych on the board
    vec4 all = closed ? vec4(u_panels[1].x - FW, u_panels[1].y - FW, u_panels[1].z + FW, u_panels[1].w + FW)
                      : vec4(u_panels[0].x - FW, u_panels[0].y - FW, u_panels[2].z + FW, u_panels[2].w + FW);
    vec2 sh = max(vec2(all.x - w.x, all.y - (w.y - 900.0)), vec2(w.x - all.z, (w.y - 900.0) - all.w));
    float sd = max(sh.x, sh.y);
    col *= mix(0.35, 1.0, smoothstep(-200.0, 4500.0, sd));
    float a;
    vec3 fc = frame(w, u_panels[bi], FW, a);
    col = mix(col, fc, a);
    // iron hinges in the gaps between the wings
    for (int h = 0; h < 2; h++) {
      if (closed) break;
      float gx = h == 0 ? (u_panels[0].z + u_panels[1].x) * 0.5 : (u_panels[1].z + u_panels[2].x) * 0.5;
      for (int j = 0; j < 3; j++) {
        float gy = mix(u_panels[1].y, u_panels[1].w, j == 0 ? 0.12 : j == 1 ? 0.5 : 0.88);
        vec2 hp = (w - vec2(gx, gy)) / vec2(1500.0, 2600.0);
        float box = max(abs(hp.x), abs(hp.y));
        if (box < 0.5) {
          float knuckle = smoothstep(0.12, 0.0, abs(hp.x)) ;
          vec3 iron = vec3(0.09, 0.085, 0.08) * (0.7 + 0.6 * fbm(w / 120.0)) + knuckle * 0.12;
          iron += smoothstep(0.05, 0.0, abs(length(hp - vec2(0.0, 0.32)) - 0.06)) * 0.15;
          iron += smoothstep(0.05, 0.0, abs(length(hp - vec2(0.0, -0.32)) - 0.06)) * 0.15;
          col = mix(col, iron, smoothstep(0.5, 0.47, box));
        }
      }
    }
    o = vec4(col, 1.0);
    return;
  }

  vec2 uvw = w / u_world;
  vec4 fx = texture(u_fx, uvw);
  float life = u_life;
  // displacement amplitude in physical px: visible at any zoom, never violent
  float amp = clamp(28.0 * k, 0.5, 3.2) * life;
  vec2 disp = vec2(0.0);
  float t = u_time;

  // water: travelling ripples
  float water = fx.r;
  float isOpen = smoothstep(0.6, 0.9, water);
  vec3 nrm = vec3(0.0, 0.0, 1.0);
  if (water > 0.01) {
    vec2 p = w / 420.0;
    vec2 g = vec2(cos(p.x * 1.7 + p.y * 0.6 + t * 1.6) * 1.7 - cos(p.x * -0.8 + p.y * 2.1 - t * 1.25) * 0.8,
                  cos(p.x * 1.7 + p.y * 0.6 + t * 1.6) * 0.6 + cos(p.x * -0.8 + p.y * 2.1 - t * 1.25) * 2.1);
    disp += g * 0.35 * amp * isOpen * water;
    nrm = normalize(vec3(g * 0.25 * isOpen, 1.0));
  }
  // foliage: slow sway, stronger higher up in the canopy
  float fol = fx.b;
  if (fol > 0.01) {
    float s = sin(t * 0.9 + w.x / 3500.0 + w.y / 9000.0) + 0.5 * sin(t * 2.3 + w.x / 900.0);
    disp.x += s * fol * amp * 0.45;
  }
  // the cavalcade gallops round the Pool of Youth: a bounce that travels along the ring
  {
    vec2 q = (w - u_ring.xy) / u_ring.zw;
    float ro = length(q);
    float ri = length((w - u_ring.xy) / u_ringIn);
    float ringMask = (1.0 - smoothstep(0.9, 1.02, ro)) * smoothstep(1.05, 1.35, ri);
    if (ringMask > 0.0) {
      float ang = atan(q.y, q.x);
      float gallop = abs(sin(ang * 9.0 + t * 3.3)) - 0.6;
      disp.y += gallop * ringMask * amp * 0.75;
    }
  }
  // swans and ducks bob on the water
  for (int i = 0; i < 8; i++) {
    vec4 b = u_bobs[i];
    if (b.z <= 0.0) continue;
    float d = length(w - b.xy) / b.z;
    if (d < 1.0) {
      float f = 1.0 - smoothstep(0.35, 1.0, d);
      disp.y += sin(t * (1.1 + float(i) * 0.13) + float(i) * 1.7) * f * clamp(b.w * k, 0.4, 2.2) * life;
    }
  }
  // animated figures: each rig warps its region about a pivot (sampling the inverse motion)
  for (int i = 0; i < 16; i++) {
    if (i >= u_rigN) break;
    vec4 A = u_rigA[i], B = u_rigB[i], C = u_rigC[i];
    vec2 r = w - A.xy;
    vec2 lr = vec2(r.x * B.x + r.y * B.y, -r.x * B.y + r.y * B.x) / A.zw;
    float d = length(lr);
    if (d >= 1.0) continue;
    float wt = 1.0 - smoothstep(1.0 - B.z, 1.0, d);
    vec2 ws = w;
    if (B.w < 1.5) {               // rotate about the pivot
      float a = -C.z * wt;
      vec2 q = w - C.xy;
      ws = C.xy + vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
    } else if (B.w < 2.5) {        // translate
      ws = w - C.zw * wt;
    } else {                        // scale about the pivot (breathing)
      ws = C.xy + (w - C.xy) / (1.0 + C.z * wt);
    }
    disp += (ws - w) * k * life;
  }
  // fire: heat haze rising
  float fireWide = textureLod(u_fx, uvw, 3.0).g;
  float fire = fx.g;
  if (fireWide > 0.01) {
    disp.y += sin(w.y / 160.0 - t * 6.0 + w.x / 300.0) * fireWide * amp * 0.5;
  }

  vec2 suv = (frag + disp * vec2(1.0, -1.0)) / u_view;
  vec3 col = texture(u_scene, suv).rgb;

  // water light: glints on open water, a slow sheen across the ice
  if (water > 0.01) {
    vec3 L = normalize(vec3(sin(t * 0.07) * 0.4, -0.5, 0.75));
    float spec = pow(clamp(dot(reflect(-L, nrm), vec3(0, 0, 1)), 0.0, 1.0), 60.0);
    // broken horizontal crests catching the light, like Bosch's white water strokes
    float crestPhase = w.y / 95.0 + fbm(w / vec2(1400.0, 500.0)) * 5.0 - t * 0.9;
    float crest = pow(0.5 + 0.5 * sin(crestPhase), 18.0);
    float broken = smoothstep(0.55, 0.8, vnoise(vec2(w.x / 260.0 + t * 0.15, w.y / 60.0)));
    // up close the coarse effect mask would show its blotches: let the brushwork speak instead
    float far = 1.0 - smoothstep(0.08, 0.35, k);
    col += (spec * 0.12 + crest * broken * 0.16) * isOpen * water * life * far;
    float ice = smoothstep(0.3, 0.5, textureLod(u_fx, uvw, 2.0).r) * (1.0 - isOpen) * far;
    float band = smoothstep(0.0, 0.5, 0.5 - abs(fract((w.x + w.y * 0.6) / 30000.0 - t * 0.035) - 0.5) * 6.0);
    col += ice * band * vec3(0.08, 0.1, 0.13) * life;
  }
  // fire light: flicker and glow
  if (fireWide > 0.005 || fire > 0.0) {
    float fl = 0.65 + 0.35 * vnoise(vec2(t * 9.0, w.x / 700.0 + w.y / 900.0)) * (0.7 + 0.3 * sin(t * 23.0 + w.x));
    col += vec3(1.0, 0.45, 0.12) * fire * fl * 0.45 * life;
    col += vec3(0.9, 0.35, 0.08) * fireWide * fl * 0.28 * life;
  }
  // sky: Eden and Garden breathe light, Hell's night is torn by lightning
  float sky = fx.a;
  if (sky > 0.01) {
    float isNight = 1.0 - smoothstep(0.6, 0.9, sky);
    float day = sky * (1.0 - isNight);
    float cloud = fbm(w / 6000.0 + vec2(t * 0.02, 0.0));
    col *= 1.0 + day * (cloud - 0.5) * 0.08 * life;
    // fade out toward the bottom of the mask so a flash never shows the mask's edge
    col += isNight * sky * u_flash * vec3(0.55, 0.6, 0.75) * (0.6 + 0.4 * cloud) * smoothstep(0.27, 0.12, w.y / u_world.y);
  }
  // lightning lights the whole of Hell a little
  if (pi == 2) col += u_flash * 0.07 * vec3(0.6, 0.65, 0.8) * smoothstep(0.55, 0.0, w.y / u_world.y);

  // craquelure: appears as you come close, scale of real cracks (~2-4 mm)
  float cvis = smoothstep(0.035, 0.18, k) * u_age;
  if (u_deepOn > 0.0 && cvis > 0.0) {
    for (int i = 0; i < 48; i++) {
      vec3 h = u_deep[i];
      if (h.z <= 0.0) break;
      float d = length(w - h.xy) / h.z;
      cvis *= mix(1.0, smoothstep(0.7, 1.0, d), u_deepOn);
    }
  }
  if (cvis > 0.0) {
    vec2 cp = w / 130.0 + vec2(fbm(w / 400.0), fbm(w / 400.0 + 9.0)) * 0.7;
    float e = cracks(cp);
    float width = 1.2 / (k * 130.0); // ~1.2 physical px
    float cr = 1.0 - smoothstep(0.0, width + 0.015, e);
    float lifted = smoothstep(0.02 + width, 0.0, abs(e - width * 1.6)) * 0.06;
    col *= 1.0 - cr * 0.32 * cvis;
    col += lifted * cvis;
  }
  // varnish: a faint warm glaze, and an optional raking light from the pointer
  col = mix(col, col * vec3(1.03, 1.0, 0.92), 0.5 * u_age);
  if (u_rake > 0.0) {
    float dl = length(w - u_pointer) * k / max(u_view.x, u_view.y);
    col *= 1.0 + u_rake * (0.35 * exp(-dl * dl * 9.0) - 0.15);
  }
  // panel edge shading under the frame lip
  vec4 R = u_panels[pi];
  float edge = min(min(w.x - R.x, R.z - w.x), min(w.y - R.y, R.w - w.y));
  col *= mix(0.55, 1.0, smoothstep(0.0, 380.0, edge));
  o = vec4(col, 1.0);
}`;

export class Post {
  constructor(gl, quad, scene) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS, 'post');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.panels = new Float32Array(12);
    // frames sit over the scan's dark gaps: inset the painted rects slightly
    const inset = 140;
    scene.panels.forEach((p, i) => this.panels.set([p.x0 + inset, p.y0 + inset, p.x1 - inset, p.y1 - inset], i * 4));
    this.fx = null;
    this.age = 1;
    this.life = 1;
    this.flash = 0;
    this.rake = 0;
    this.pointer = [0, 0];
    this.flashes = [];
    this.nextFlash = 4;
    const W = WORLD_W, H = WORLD_H;
    // painted swan and ducks on Eden's pond (normalized positions read from the painting)
    const bobs = [[0.171, 0.479, 0.0065], [0.074, 0.497, 0.004], [0.075, 0.519, 0.004], [0.212, 0.552, 0.004]];
    this.bobs = new Float32Array(32);
    bobs.forEach(([x, y, r], i) => this.bobs.set([x * W, y * H, r * W, 26], i * 4));
    this.ring = [0.505 * W, 0.445 * H, 0.135 * W, 0.115 * H];
    // same circles as tools/prepareDeep.js (z7: every story point, radius padded by 1.15)
    this.deep = new Float32Array(48 * 3);
    scene.pois.filter((p) => !p.overview).slice(0, 48).forEach((p, i) => this.deep.set([p.x, p.y, p.r * 1.15], i * 3));
    this.ringIn = [0.074 * W, 0.034 * H];
    this.hideWings = 0;
    this.rigA = new Float32Array(64); this.rigB = new Float32Array(64); this.rigC = new Float32Array(64);
    this.rigN = 0;
  }

  // Active rigs for this frame: [{ cx, cy, rx, ry, angle, feather, kind, px, py, a, b }] in world px / radians.
  setRigs(list) {
    const n = Math.min(16, list.length);
    for (let i = 0; i < n; i++) {
      const r = list[i];
      this.rigA.set([r.cx, r.cy, r.rx, r.ry], i * 4);
      this.rigB.set([Math.cos(r.angle), Math.sin(r.angle), r.feather, r.kind], i * 4);
      this.rigC.set([r.px, r.py, r.a, r.b], i * 4);
    }
    this.rigN = n;
  }

  async loadEffects(url) {
    const gl = this.gl;
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fx = t;
  }

  // Lightning over Hell: irregular double flickers. Returns true when a strike starts.
  tickFlash(time) {
    let struck = false;
    if (time > this.nextFlash) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.flashes.push({ t0: time + i * (0.09 + Math.random() * 0.12), a: 0.5 + Math.random() * 0.5 });
      this.nextFlash = time + 5 + Math.random() * 14;
      struck = true;
    }
    let f = 0;
    this.flashes = this.flashes.filter((fl) => time - fl.t0 < 0.6);
    for (const fl of this.flashes) {
      const dt = time - fl.t0;
      if (dt >= 0) f = Math.max(f, fl.a * Math.exp(-dt * 9));
    }
    this.flash = f * this.life;
    return struck;
  }

  draw(gl, scene, info) {
    const c = info.camera;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.useProgram(this.prog.program);
    const u = this.prog.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(u.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fx);
    gl.uniform1i(u.u_fx, 1);
    gl.uniform2f(u.u_view, scene.w, scene.h);
    gl.uniform3f(u.u_cam, c.cx, c.cy, c.scale * info.dpr);
    gl.uniform1f(u.u_time, info.time);
    gl.uniform1f(u.u_age, this.age);
    gl.uniform1f(u.u_life, this.fx ? this.life : 0);
    gl.uniform1f(u.u_flash, this.flash);
    gl.uniform4fv(u.u_panels, this.panels);
    gl.uniform2f(u.u_world, WORLD_W, WORLD_H);
    gl.uniform2f(u.u_pointer, this.pointer[0], this.pointer[1]);
    gl.uniform1f(u.u_rake, this.rake);
    gl.uniform4fv(u.u_bobs, this.bobs);
    gl.uniform4f(u.u_ring, ...this.ring);
    gl.uniform2f(u.u_ringIn, ...this.ringIn);
    gl.uniform3fv(u.u_deep, this.deep);
    gl.uniform1f(u.u_deepOn, info.zr >= 7 ? 1 : 0);
    gl.uniform1f(u.u_hideWings, this.hideWings);
    gl.uniform4fv(u.u_rigA, this.rigA);
    gl.uniform4fv(u.u_rigB, this.rigB);
    gl.uniform4fv(u.u_rigC, this.rigC);
    gl.uniform1i(u.u_rigN, this.rigN);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
