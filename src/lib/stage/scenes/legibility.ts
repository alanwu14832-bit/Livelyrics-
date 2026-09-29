// 可讀性保證 (phase 7): the type pass attenuates the picture under a dilated mask of the readable
// glyphs until the lyric colour meets a WCAG contrast ratio against it — whatever the scene program
// (or a built-in scene) draws there. Light ink darkens the picture around the letters, dark ink
// lifts it. The contrast is aimed at what leaves the wall: the LED safety pass that follows (its
// soften shoulder and brightness cap) is taken into account. The GLSL below and the TypeScript
// mirror use the same sRGB transfer and the same math, so the unit test on the mirror states what
// the shader does.

import { softenChannel } from "../safety";

/** The contrast the type pass aims for (the check asks for ≥ 4.5 : 1; the margin covers the soft
 * edge of the mask and the grain). */
export const LEGIBLE_TARGET = 5.4;
/** The contrast every readable lyric must meet against the picture around it. */
export const LEGIBLE_MIN = 4.5;
/** The dilation ring radii, as fractions of the output's shorter side. */
export const LEGIBLE_RING = [0.006, 0.014] as const;

export type Rgb = readonly [number, number, number];
/** The LED safety pass after the type pass: soften amount and brightness-cap gain (sRGB). */
export interface PostSafety {
  soften: number;
  gain: number;
}
const NO_POST: PostSafety = { soften: 0, gain: 1 };

const toLinC = (c: number) => {
  const x = Math.min(1, Math.max(0, c));
  return x < 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const toSrgbC = (l: number) => {
  const x = Math.min(1, Math.max(0, l));
  return x < 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};
const lumLin = (l: readonly number[]) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];

/** WCAG relative luminance of an sRGB colour (0–1 channels). */
export function relativeLuminance(c: Rgb): number {
  return lumLin(c.map(toLinC));
}

/** WCAG contrast ratio of two sRGB colours (1–21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A colour as the safety pass puts it out. */
export function afterSafety(c: Rgb, post: PostSafety = NO_POST): [number, number, number] {
  const g = Math.min(1, Math.max(0.05, post.gain));
  return c.map((v) => softenChannel(v, post.soften) * g) as [number, number, number];
}

/** The ink's output luminance, the capped white's, and the split between the two strategies: above
 * it a black picture gives more contrast than the brightest the cap allows. */
function inkState(ink: Rgb, post: PostSafety) {
  const li = relativeLuminance(afterSafety(ink, post));
  // gl: how the cap scales a dark picture (below the shoulder); cw: the brightest output (white
  // through the shoulder and the cap) — a lifted picture or ink reaches at least `pre × cw`
  const gl = toLinC(Math.min(1, Math.max(0.05, post.gain)));
  const cw = relativeLuminance(afterSafety([1, 1, 1], post));
  const split = Math.sqrt(0.05 * (cw + 0.05)) - 0.05;
  return { li, gl, cw, split };
}

/** The ink colour after the guarantee: an ink that could reach the target over neither black nor
 * the capped white (a mid-grey, a mid pink) is lifted until it reads over black (mirror of `legibleInk`). */
export function legibleInk(ink: Rgb, post: PostSafety = NO_POST, target = LEGIBLE_TARGET): [number, number, number] {
  const { li, cw } = inkState(ink, post);
  const light = 0.05 * target - 0.05 + 0.004;
  const dark = (cw + 0.05) / target - 0.05;
  if (li >= light || li <= dark) return [...ink] as [number, number, number];
  const lin = ink.map(toLinC);
  const pre = lumLin(lin);
  const want = Math.min(1, (light / cw) * 1.02);
  const t = Math.max(0, (want - pre) / Math.max(1 - pre, 1e-5));
  return lin.map((v) => toSrgbC(v + (1 - v) * t)) as [number, number, number];
}

/** The picture colour after the guarantee (mirror of the GLSL `legibleBg`). */
export function legibleBackground(bg: Rgb, ink: Rgb, target = LEGIBLE_TARGET, post: PostSafety = NO_POST): [number, number, number] {
  let lin = bg.map(toLinC) as [number, number, number];
  const lb = lumLin(lin);
  const { li, gl, cw, split } = inkState(ink, post);
  if (li > split) {
    const maxB = ((li + 0.05) / target - 0.05) / gl;
    if (lb > maxB) {
      const k = Math.max(maxB, 0) / Math.max(lb, 1e-5);
      lin = lin.map((v) => v * k) as [number, number, number];
    }
  } else {
    const minB = Math.min(1, (target * (li + 0.05) - 0.05) / cw);
    if (lb < minB) {
      const t = (minB - lb) / Math.max(1 - lb, 1e-5);
      lin = lin.map((v) => v + (1 - v) * t) as [number, number, number];
    }
  }
  return lin.map(toSrgbC) as [number, number, number];
}

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** GLSL helpers for the type pass (needs uRes, uType, softenC and the TEX macro). */
export const LEGIBILITY_GLSL = /* glsl */ `
vec3 legToLin(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 legToSrgb(vec3 l) {
  l = clamp(l, 0.0, 1.0);
  return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), l));
}
float legLum(vec3 lin) { return dot(lin, vec3(0.2126, 0.7152, 0.0722)); }
// the ink's luminance as it leaves the wall (after the safety pass' soften and cap)
float legInkOut(vec3 ink, float soft, float gain) { return legLum(legToLin(softenC(ink, soft) * clamp(gain, 0.05, 1.0))); }
// how the cap scales a dark picture (below the shoulder)
float legCapLum(float gain) { return legLum(legToLin(vec3(clamp(gain, 0.05, 1.0)))); }
// an ink that could reach the target over neither black nor the capped white is lifted
vec3 legibleInk(vec3 ink, float soft, float gain) {
  float li = legInkOut(ink, soft, gain);
  float cw = legInkOut(vec3(1.0), soft, gain);
  float light = ${f(0.05 * LEGIBLE_TARGET - 0.05 + 0.004)};
  float dark = (cw + 0.05) / ${f(LEGIBLE_TARGET)} - 0.05;
  if (li >= light || li <= dark) return ink;
  vec3 il = legToLin(ink);
  float pre = legLum(il);
  float want = min(1.0, light / cw * 1.02);
  return legToSrgb(il + (1.0 - il) * max(0.0, (want - pre) / max(1.0 - pre, 1e-5)));
}
// the picture under the letters, attenuated until the ink meets the target contrast against it
vec3 legibleBg(vec3 bg, vec3 ink, float soft, float gain) {
  vec3 bl = legToLin(bg);
  float lb = legLum(bl);
  float li = legInkOut(ink, soft, gain);
  float gl = legCapLum(gain);
  // the brightest output (white through the shoulder and the cap)
  float cw = legInkOut(vec3(1.0), soft, gain);
  float split = sqrt(0.05 * (cw + 0.05)) - 0.05;
  if (li > split) {
    float maxB = ((li + 0.05) / ${f(LEGIBLE_TARGET)} - 0.05) / gl;
    if (lb > maxB) bl *= max(maxB, 0.0) / max(lb, 1e-5);
  } else {
    float minB = min(1.0, (${f(LEGIBLE_TARGET)} * (li + 0.05) - 0.05) / cw);
    if (lb < minB) bl += (1.0 - bl) * ((minB - lb) / max(1.0 - lb, 1e-5));
  }
  return legToSrgb(bl);
}
// the readable glyphs dilated: rings of ink / accent taps plus the painter's halo (which already
// follows each glyph's size; giant display glyphs have no halo, the rings cover them)
float legibleCover(vec2 uv, float halo) {
  float r1 = ${f(LEGIBLE_RING[0])} * min(uRes.x, uRes.y);
  float r2 = ${f(LEGIBLE_RING[1])} * min(uRes.x, uRes.y);
  vec2 px = 1.0 / uRes;
  float m = 0.0;
  // ink and accent plates (the lyric and its labels, numbers and brackets): 8 taps on the inner
  // ring, 12 on the outer (so a thin stroke between two outer taps is not missed)
  for (int i = 0; i < 8; i++) {
    float an = float(i) * 0.785398;
    vec4 t1 = TEX(uType, clamp(uv + vec2(cos(an), sin(an)) * r1 * px, 0.0, 1.0));
    m = max(m, max(t1.r, t1.g));
  }
  for (int i = 0; i < 12; i++) {
    float an = float(i) * 0.523599 + 0.26;
    vec4 t2 = TEX(uType, clamp(uv + vec2(cos(an), sin(an)) * r2 * px, 0.0, 1.0));
    m = max(m, max(t2.r, t2.g) * 0.85);
  }
  return max(smoothstep(0.04, 0.45, m), smoothstep(0.02, 0.3, halo));
}
`;
