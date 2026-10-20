// GLSL for the stroke painter and the compositor.
// The stroke footprint mirrors coverageLocal() in src/shared/strokeModel.ts exactly.
import { SOFT_FRAC, MIN_SOFT, BRISTLE_DEPTH, DRY_DEPTH, POS_OFFSET, POS_SCALE } from '../shared/strokeModel.ts';

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const STROKE_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_corner;      // 0..1 quad corner
layout(location=1) in vec2 a_pos;         // quantized center (u16 x2)
layout(location=2) in uvec4 a_geo;        // angle, len, bend(i8), width
layout(location=3) in uvec4 a_col;        // r, g, b, alpha<<4|seed
uniform vec2 u_offset;   // fileOrigin*scale - dstOrigin, render px
uniform float u_scale;   // render px per native px
uniform vec2 u_dstSize;  // render target size in px
uniform float u_strokeView; // 1: show every stroke in its own colour
out vec2 v_local;
flat out vec4 v_shape;   // r, len, bend, seed
flat out vec4 v_color;   // rgb 0..1, alpha
const float PI = 3.14159265358979;
uint vhash(uint x) { x = (x ^ 61u) ^ (x >> 16); x *= 9u; x = x ^ (x >> 4); x *= 0x27d4eb2du; return x ^ (x >> 15); }
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
const float SOFT_FRAC = ${f(SOFT_FRAC)};
const float MIN_SOFT = ${f(MIN_SOFT)};
void main() {
  vec2 c = a_pos / ${f(POS_SCALE)} - ${f(POS_OFFSET)};
  float ang = float(a_geo.x) / 256.0 * PI;
  float width = 0.5 * exp2(float(a_geo.w) / 32.0);
  float len = float(a_geo.y) / 16.0 * width;
  int bi = int(a_geo.z); if (bi > 127) bi -= 256;
  float bend = float(bi) / 127.0 * PI;
  float r = width * 0.5;
  float pad = r + max(SOFT_FRAC * r, MIN_SOFT / u_scale) + 1.0 / u_scale;
  float halfL = len * 0.5;
  float k = len > 1e-4 ? bend / len : 0.0;
  float xmax, sag;
  if (abs(k) < 1e-4) { xmax = halfL; sag = 0.0; }
  else {
    xmax = abs(k * halfL) > PI * 0.5 ? 1.0 / abs(k) : abs(sin(k * halfL) / k);
    sag = (1.0 - cos(abs(k * halfL))) / k;
  }
  vec2 lo = vec2(-xmax - pad, min(0.0, sag) - pad);
  vec2 hi = vec2(xmax + pad, max(0.0, sag) + pad);
  vec2 l = mix(lo, hi, a_corner);
  float ca = cos(ang), sa = sin(ang);
  vec2 p = c + vec2(l.x * ca - l.y * sa, l.x * sa + l.y * ca);
  vec2 d = p * u_scale + u_offset;
  gl_Position = vec4(d / u_dstSize * 2.0 - 1.0, 0.0, 1.0);
  v_local = l;
  v_shape = vec4(r, len, bend, float(a_col.w & 15u));
  v_color = vec4(vec3(a_col.rgb) / 255.0, float(a_col.w >> 4) / 15.0);
  if (u_strokeView > 0.5) {
    // a colour that depends only on the stroke record, so it agrees across tiles
    uint h = vhash(uint(a_pos.x) * 73856093u ^ uint(a_pos.y) * 19349663u ^ (a_geo.x << 24 | a_geo.y << 16 | a_geo.z << 8 | a_geo.w));
    vec3 vivid = mix(vec3(0.15), hue(float(h & 4095u) / 4095.0), 0.8);
    float lum = dot(v_color.rgb, vec3(0.299, 0.587, 0.114));
    v_color.rgb = mix(vivid * (0.45 + 0.75 * lum), v_color.rgb, 0.15);
    v_color.a = 1.0;
  }
}`;

export const STROKE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_local;
flat in vec4 v_shape;
flat in vec4 v_color;
uniform float u_scale;
uniform float u_fade;    // 0..1, used by the paint-in animation
uniform float u_strokeView;
out vec4 o;
const float SOFT_FRAC = ${f(SOFT_FRAC)};
const float MIN_SOFT = ${f(MIN_SOFT)};
const float BRISTLE_DEPTH = ${f(BRISTLE_DEPTH)};
const float DRY_DEPTH = ${f(DRY_DEPTH)};
uint hash32(uint x) {
  x = (x ^ 61u) ^ (x >> 16);
  x *= 9u;
  x = x ^ (x >> 4);
  x *= 0x27d4eb2du;
  x = x ^ (x >> 15);
  return x;
}
float h01(int i, int seed) { return float(hash32(uint(i + seed * 7919 + 1013))) / 4294967296.0; }
float vnoise1(float x, int seed) {
  float fi = floor(x); float fr = x - fi; int i = int(fi);
  float u = fr * fr * (3.0 - 2.0 * fr);
  return mix(h01(i, seed), h01(i + 1, seed), u);
}
void main() {
  float r = v_shape.x, len = v_shape.y, bend = v_shape.z;
  int seed = int(v_shape.w);
  vec2 l = v_local;
  float halfL = len * 0.5;
  float k = len > 1e-4 ? bend / len : 0.0;
  float sArc, d, v;
  if (abs(k) < 1e-4) {
    sArc = clamp(l.x, -halfL, halfL);
    d = length(vec2(l.x - sArc, l.y));
    v = l.y;
  } else {
    float R = 1.0 / k;
    vec2 q = vec2(l.x, l.y - R);
    float sg = k > 0.0 ? 1.0 : -1.0;
    float phi = atan(sg * q.x, -sg * q.y);
    sArc = clamp(phi / k, -halfL, halfL);
    vec2 p = vec2(sin(k * sArc) / k, (1.0 - cos(k * sArc)) / k);
    d = length(l - p);
    v = sg * (abs(R) - length(q));
  }
  float soft = max(SOFT_FRAC * r, MIN_SOFT / u_scale);
  float shape = clamp((r - d) / soft + 0.5, 0.0, 1.0);
  if (shape <= 0.0) discard;
  float nb = 3.0 + r * 1.2;
  float bx = (clamp(v / r, -1.0, 1.0) * 0.5 + 0.5) * nb;
  float streak = vnoise1(bx, seed);
  float u = (sArc + halfL) / (2.0 * halfL + r);
  float dry = DRY_DEPTH * clamp((u - 0.55) / 0.45, 0.0, 1.0) * vnoise1(bx * 1.7 + 5.0, seed + 1);
  float a = shape * (1.0 - BRISTLE_DEPTH * streak) * (1.0 - dry) * v_color.a * u_fade;
  vec3 col = v_color.rgb;
  if (u_strokeView > 0.5) col *= mix(0.35, 1.0, smoothstep(0.0, max(0.6 / u_scale, 0.18 * r), r - d)); // dark rim per stroke
  o = vec4(col, a);
}`;

// Ground fill for a tile slot (chalk ground; must match GROUND in tools/paintTile.ts).
export const FILL_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
void main() { gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0); }`;
export const FILL_FS = `#version 300 es
precision highp float;
uniform vec3 u_color;
out vec4 o;
void main() { o = vec4(u_color, 1.0); }`;

// Draw atlas tiles onto the scene buffer (instanced quads).
export const TILE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_dst;   // x0, y0, x1, y1 in scene px (y down)
layout(location=2) in vec4 a_src;   // u0, v0, u1, v1 in atlas uv
uniform vec2 u_view;
out vec2 v_uv;
void main() {
  vec2 p = mix(a_dst.xy, a_dst.zw, a_corner);
  gl_Position = vec4(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0, 0.0, 1.0);
  v_uv = mix(a_src.xy, a_src.zw, a_corner);
}`;
export const TILE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_atlas;
out vec4 o;
void main() { o = vec4(texture(u_atlas, v_uv).rgb, 1.0); }`;
