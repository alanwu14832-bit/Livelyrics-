// Shared GLSL for every scene. Scenes are written in the common subset of
// GLSL ES 1.00 / 3.00 (constant loop bounds, no arrays, no round()/tanh()) so the
// same body compiles on WebGL2 and the WebGL1 fallback. Each scene defines
//   vec3 scene(vec2 fc)   // fc = gl_FragCoord.xy, returns display-referred sRGB
// and the prelude's main() applies vignette, soft highlight roll-off, film grain
// and dithering (prevents banding in slow gradients on big LED walls).

export const UNIFORM_NAMES = [
  "uRes",
  "uTime",
  "uClock",
  "uBg",
  "uPri",
  "uAcc",
  "uSpeed",
  "uDensity",
  "uIntensity",
  "uReact",
  "uLevel",
  "uBass",
  "uOnset",
  "uBeat",
  "uBeatN",
  "uEnergy",
  "uPulse",
  "uSeed",
  "uMotif",
] as const;
export type UniformName = (typeof UNIFORM_NAMES)[number];

function header(gl2: boolean): string {
  return gl2
    ? `#version 300 es
precision highp float;
precision highp int;
out vec4 outColor;
#define FRAG outColor
#define TEX texture
`
    : `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define FRAG gl_FragColor
#define TEX texture2D
`;
}

export const PRELUDE = /* glsl */ `
uniform vec2 uRes;
uniform float uTime;      // speed-integrated scene clock (stops on freeze)
uniform float uClock;     // wall clock for grain (stops on freeze)
uniform vec3 uBg;         // colorway[0] background
uniform vec3 uPri;        // colorway[1] primary
uniform vec3 uAcc;        // colorway[2] accent
uniform float uSpeed;
uniform float uDensity;
uniform float uIntensity; // section intensity x master intensity (0..1.5)
uniform float uReact;     // audio reactivity 0..1
uniform float uLevel;
uniform float uBass;
uniform float uOnset;
uniform float uBeat;      // 0..1 phase inside the beat
uniform float uBeatN;     // beat counter (changes once per beat)
uniform float uEnergy;
uniform float uPulse;     // beat punch 0..1.5
uniform float uSeed;
uniform sampler2D uMotif; // key-visual motif, white on transparent, mipmapped

#define PI 3.14159265
#define TAU 6.28318531

float sat(float x) { return clamp(x, 0.0, 1.0); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// "hash without sine" (Dave Hoskins) - stable at large inputs
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p + 3.7; a *= 0.5; }
  return v / 0.96875;
}

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = m * p + 3.7; a *= 0.5; }
  return v / 0.875;
}

// aspect-correct centred coordinates, y in [-0.5, 0.5]
vec2 centered(vec2 fc) { return (fc - 0.5 * uRes) / uRes.y; }

// beat punch scaled by the section's reactivity
float kick() { return uPulse * uReact; }

// background -> primary -> accent ramp
vec3 ramp(float t) {
  t = sat(t);
  vec3 c = mix(uBg, uPri, smoothstep(0.0, 0.62, t));
  return mix(c, uAcc, smoothstep(0.58, 1.0, t));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// sample the motif mask at uv (0..1), zero outside
float motifMask(vec2 uv, float bias) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return TEX(uMotif, clamp(uv, 0.0, 1.0), bias).a * inside.x * inside.y;
}
`;

export const POST = /* glsl */ `
vec3 softKnee(vec3 c) {
  vec3 k = vec3(0.78);
  vec3 over = max(c - k, 0.0);
  return min(c, k) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}

vec3 post(vec3 col, vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 q = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float vig = smoothstep(1.15, 0.25, length(q * vec2(0.78, 1.0)));
  col *= mix(0.42, 1.0, vig);
  col *= 1.22 * pow(max(uIntensity, 0.0), 0.72);
  col = softKnee(max(col, 0.0));
  float l = luma(col);
  float g = hash12(fc * 0.9173 + vec2(fract(uClock * 7.13) * 517.0, fract(uClock * 3.71) * 389.0)) - 0.5;
  col += g * 0.05 * l * (1.15 - l);
  // interleaved gradient noise: blue-noise-like dither, no visible pattern
  float ign = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  col += (ign - 0.5) * (1.5 / 255.0) * step(0.003, l);
  return clamp(col, 0.0, 1.0);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec3 col = scene(fc);
  FRAG = vec4(post(col, fc), 1.0);
}
`;

export function buildSceneFragment(body: string, gl2: boolean): string {
  return header(gl2) + PRELUDE + body + POST;
}

export function buildVertex(gl2: boolean): string {
  return gl2
    ? `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`
    : `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;
}

export function buildFragmentWithHeader(src: string, gl2: boolean): string {
  return header(gl2) + src;
}
