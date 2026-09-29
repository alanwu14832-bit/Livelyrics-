// 專屬畫面 (phase 7), the offline path: a layered generative composer. Without Claude a song still
// gets its own program, assembled from hand-written GLSL modules along four axes —
//
//   form × texture × composition × motion
//
// form: the one dominant image of the song (a disc over a horizon, standing pillars, orbits,
//   receding strata, printed bars, a brush stroke, silk ribbons, falling threads), each with its
//   own parameter space (horizon height, disc size and banding, pillar count, ring tilt, layer
//   count and roughness, bar angle and rhythm, stroke shape, ribbon count, thread density);
// texture: the surface it is printed on (film grain, halftone, paper fibre, scan lines);
// composition: where the form stands (opposite the words), how high the horizon sits, how large;
// motion: how the world moves (drift, breathe, rise, orbit, sweep) and how fast.
//
// The form is chosen from the song's findings (imagery, genre, audio mood), the rest from its seed,
// so two songs differ in structure, not only in colour. The same section semantics as the example
// programs: uMode 0 sparse (verses), 1 building, 2 open (choruses), 3 the rule changes (bridge);
// uParams = (openness, density, light, motion). Pure and deterministic: the same input gives the
// same program text.

import type { SceneProgram, SceneProgramSection, SectionKind, TypeRelation, TypeVoiceId, Zone } from "../../types";
import { KIND_DEFAULTS } from "./model";

export const FORM_IDS = ["horizon", "pillars", "orbits", "strata", "bars", "brush", "ribbons", "threads"] as const;
export type FormId = (typeof FORM_IDS)[number];
export const TEXTURE_IDS = ["film", "halftone", "paper", "scan"] as const;
export type TextureId = (typeof TEXTURE_IDS)[number];
export const MOTION_IDS = ["drift", "breathe", "rise", "orbit", "sweep"] as const;
export type MotionId = (typeof MOTION_IDS)[number];

export const FORM_LABELS: Record<FormId, string> = {
  horizon: "地平線上的圓",
  pillars: "佇立的碑",
  orbits: "軌道",
  strata: "層疊的山脈",
  bars: "印刷的斜線",
  brush: "一筆墨",
  ribbons: "絲帶",
  threads: "落下的光絲",
};
export const TEXTURE_LABELS: Record<TextureId, string> = { film: "底片顆粒", halftone: "網點", paper: "紙纖維", scan: "掃描線" };
export const MOTION_LABELS: Record<MotionId, string> = { drift: "漂移", breathe: "呼吸", rise: "上升", orbit: "繞行", sweep: "掃過" };

export interface ComposerSection {
  id: string;
  kind: SectionKind;
  energy: number;
}

export interface ComposerInput {
  /** a stable hash of the song (title | artist) */
  seed: number;
  /** forms that suit the song, best first (the designer derives them from its findings) */
  forms: readonly FormId[];
  sections: readonly ComposerSection[];
  voice?: TypeVoiceId | null;
  temperature?: "warm" | "cool" | "neutral";
  /** 0..1 how driving the music is (audio mood arousal) */
  arousal?: number;
  /** the song title and a short reason (the concept sentence) */
  title?: string;
  world?: string;
  /** a salt for 「重新產生畫面」 without Claude: another draw of the same song */
  salt?: number;
}

export interface ComposerChoice {
  form: FormId;
  texture: TextureId;
  motion: MotionId;
  /** 0..1 the focal form's horizontal position away from the words */
  focalX: number;
  /** 0..1 horizon / focal height */
  focalY: number;
  scale: number;
  speed: number;
}

// deterministic random stream (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A GLSL float literal. */
function f(x: number): string {
  const v = Math.round(x * 10000) / 10000;
  const s = String(v);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

const TEXTURE_FOR_VOICE: Record<TypeVoiceId, TextureId[]> = {
  "mv-card": ["film", "film", "paper"],
  "title-sequence": ["halftone", "film", "scan"],
  ink: ["paper", "paper", "film"],
  glitch: ["scan", "halftone", "scan"],
};

const MOTION_FOR_FORM: Record<FormId, MotionId[]> = {
  horizon: ["rise", "drift", "breathe"],
  pillars: ["breathe", "rise", "drift"],
  orbits: ["orbit", "orbit", "breathe"],
  strata: ["drift", "rise", "breathe"],
  bars: ["sweep", "drift", "sweep"],
  brush: ["sweep", "breathe", "drift"],
  ribbons: ["drift", "sweep", "breathe"],
  threads: ["drift", "sweep", "rise"],
};

/** The composer's choices for a song (exported for the UI label and the tests). */
export function chooseComposition(input: ComposerInput): ComposerChoice {
  const r = rng((input.seed ^ Math.imul(input.salt ?? 0, 0x2c1b3c6d)) >>> 0);
  const forms = input.forms.length ? input.forms : FORM_IDS;
  // the best-fitting form most of the time, the second one sometimes (a salt redraws it)
  const pick = r();
  // the best-fitting form; a salt (「重新產生畫面」) draws among the three that fit best
  const form = (input.salt ? forms[(Math.floor(pick * Math.min(3, forms.length)) + (input.salt % 3)) % Math.min(3, forms.length)] : forms[0]) ?? "horizon";
  const tex = TEXTURE_FOR_VOICE[input.voice ?? "mv-card"] ?? TEXTURE_FOR_VOICE["mv-card"];
  const texture = tex[Math.floor(r() * tex.length)];
  const mot = MOTION_FOR_FORM[form];
  const motion = mot[Math.floor(r() * mot.length)];
  const arousal = Math.min(1, Math.max(0, input.arousal ?? 0.5));
  return {
    form,
    texture,
    motion,
    focalX: 0.64 + r() * 0.12,
    focalY: 0.3 + r() * 0.16,
    scale: 0.85 + r() * 0.35,
    speed: 0.5 + arousal * 0.9 + r() * 0.2,
  };
}

// ---------------------------------------------------------------------------
// GLSL modules
// ---------------------------------------------------------------------------

const COMMON = (c: ComposerChoice) => `
const float K_FX = ${f(c.focalX)};
const float K_FY = ${f(c.focalY)};
const float K_SCALE = ${f(c.scale)};
const float K_SPEED = ${f(c.speed)};

vec2 toP(vec2 q) { return (q * uRes - 0.5 * uRes) / min(uRes.x, uRes.y); }
// the form stands opposite the words: the other side on a wide frame, the other half on a tall one
vec2 focalUv() {
  vec2 z = zoneCenter();
  if (aspect() < 0.8) return vec2(0.5, z.y > 0.5 ? 0.3 : 0.68);
  return vec2(z.x < 0.5 ? K_FX : 1.0 - K_FX, K_FY + 0.18);
}
float horizonY() {
  if (aspect() < 0.8) return zoneCenter().y > 0.5 ? 0.26 : 0.56;
  return K_FY;
}
float T() { return uTime * K_SPEED; }
`;

function motionGlsl(m: MotionId): string {
  // mo(): a small offset of the form in p units; br(): a breathing scale
  switch (m) {
    case "drift":
      return `vec2 mo() { return vec2(sin(T() * 0.05), cos(T() * 0.037)) * 0.02 * (0.4 + uParams.w); }\nfloat br() { return 1.0; }`;
    case "breathe":
      return `vec2 mo() { return vec2(0.0); }\nfloat br() { return 1.0 + 0.025 * sin(T() * 0.25) * (0.4 + uParams.w) + 0.02 * kick(); }`;
    case "rise":
      return `vec2 mo() { return vec2(0.0, (uSectionProgress - 0.5) * 0.04 * (0.3 + uParams.w)); }\nfloat br() { return 1.0; }`;
    case "orbit":
      return `vec2 mo() { float a = T() * 0.06; return vec2(cos(a), sin(a)) * 0.015 * (0.4 + uParams.w); }\nfloat br() { return 1.0; }`;
    default:
      return `vec2 mo() { return vec2(sin(T() * 0.09) * 0.03 * (0.3 + uParams.w), 0.0); }\nfloat br() { return 1.0; }`;
  }
}

function textureGlsl(t: TextureId, amount: number): string {
  switch (t) {
    case "halftone":
      return `vec3 surface(vec3 col, vec2 fc, vec2 uv) {
  vec2 g = fc / (min(uRes.x, uRes.y) * 0.009);
  vec2 cf = fract(rot(0.785) * g) - 0.5;
  float l = luma(col);
  float dotm = 1.0 - smoothstep(0.0, 0.1, length(cf) - 0.52 * sqrt(sat(l * 1.6)));
  col = mix(col * ${f(0.55 + (1 - amount) * 0.3)}, col * 1.08, dotm);
  return col + grain(fc, 0.03) * (0.3 + l);
}`;
    case "paper":
      return `vec3 surface(vec3 col, vec2 fc, vec2 uv) {
  float fib = vnoise(vec2(fc.x * 0.012, fc.y * 0.28)) * vnoise(vec2(fc.x * 0.28, fc.y * 0.012));
  col *= 0.94 + 0.12 * vnoise(fc * 0.004);
  col += uInk * fib * ${f(0.02 + amount * 0.03)};
  return col + grain(fc, 0.045) * (0.3 + luma(col));
}`;
    case "scan":
      return `vec3 surface(vec3 col, vec2 fc, vec2 uv) {
  col *= 0.9 + 0.1 * sin(fc.y * 1.7);
  float band = exp(-abs(uv.y - fract(1.0 - uTime * 0.035)) * 50.0);
  col += uAcc * band * ${f(0.03 + amount * 0.05)};
  return col + grain(fc, 0.06) * (0.4 + luma(col));
}`;
    default:
      return `vec3 surface(vec3 col, vec2 fc, vec2 uv) {
  return col + grain(fc, ${f(0.03 + amount * 0.03)}) * (0.35 + luma(col));
}`;
  }
}

function formGlsl(form: FormId, r: () => number): { code: string; recipe: string } {
  switch (form) {
    case "horizon": {
      const bands = r() < 0.5 ? 0 : 3 + Math.floor(r() * 5);
      const refl = r() < 0.75 ? 1 : 0;
      const city = r() < 0.4 ? 1 : 0;
      const rad = 0.1 + r() * 0.1;
      return {
        recipe: `${bands ? `${bands} 道切線的` : ""}${city ? "城市前的" : ""}圓${refl ? "與水面倒影" : ""}`,
        code: `
const float K_R = ${f(rad)};
const float K_BANDS = ${f(bands)};
vec3 form(vec2 fc, vec2 uv, vec2 p) {
  float hz = horizonY();
  float light = uParams.z;
  vec2 fu = vec2(focalUv().x, hz);
  vec2 c = toP(fu) + mo() + vec2(0.0, K_R * K_SCALE * (uParams.x * 1.3 - 0.45));
  float r = K_R * K_SCALE * br() * (aspect() < 0.8 ? 1.3 : 1.0);
  vec2 q = p - c;
  float d = length(q);
  float up = sat((uv.y - hz) / (1.0 - hz));
  vec3 col = mix(mix(uBg, uPri, 0.2 + 0.25 * light), uBg * 0.5, pow(up, 0.65));
  vec2 sp = fc / min(uRes.x, uRes.y) * 160.0;
  col += vec3(0.85) * step(0.993, hash12(floor(sp))) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * up * (1.0 - light) * 0.7;
  col += mix(uPri, uAcc, 0.5) * exp(-d * (6.0 - 2.5 * light)) * (0.12 + 0.4 * light);
  vec3 disc = mix(mix(uPri, uAcc, 0.3), mix(uAcc, vec3(1.0), 0.4), smoothstep(-1.0, 1.0, q.y / r));
  float ny = q.y / r;
  float cut = K_BANDS > 0.5 ? step(fract((0.3 - ny) * K_BANDS * 0.5 + T() * 0.02), sat((0.15 - ny) * 0.5)) * step(ny, 0.15) : 0.0;
  if (uMode > 2.5) {
    col = mix(col, uBg * 0.3, fill(d - r));
    col += mix(uAcc, vec3(1.0), 0.3) * (stroke(d - r, 0.004) + exp(-abs(d - r) * 50.0) * 0.5);
  } else {
    col = mix(col, disc * (0.7 + 0.45 * light), fill(d - r) * (1.0 - cut) * step(hz, uv.y));
  }
  ${
    city
      ? `float cells = 110.0 * max(aspect(), 1.0);
  float cx = floor(uv.x * cells);
  float bh = hz + pow(hash11(cx * 1.7 + 3.0), 2.4) * 0.07 * step(0.4, hash11(cx * 2.9)) * smoothstep(0.3, 0.05, abs(uv.x - fu.x));
  float bld = step(uv.y, bh) * step(hz, uv.y);
  col = mix(col, uBg * 0.25 + uAcc * step(0.9, hash12(floor(fc / 5.0))) * 0.4 * step(uv.y, bh - 0.006), bld);`
      : ""
  }
  if (uv.y < hz) {
    float depth = sat((hz - uv.y) / max(hz, 0.05));
    vec3 ground = mix(uBg * 0.5 + uPri * 0.05, uBg * 0.22, pow(depth, 0.6));
    ${
      refl
        ? `float lanes = pow(depth, 0.45) * 80.0;
    float rip = fract(lanes - T() * 0.3 + vnoise(vec2(uv.x * 26.0, lanes * 0.4)) * 0.6);
    float wid = r * (0.5 + uParams.x) * (1.0 + depth * 0.6);
    float rf = (1.0 - smoothstep(wid * 0.55, wid, abs(p.x - c.x))) * step(0.5, rip) * (1.0 - depth * 0.8);
    ground += disc * rf * (0.2 + 0.55 * light) * (uMode > 2.5 ? 0.25 : 1.0);`
        : `ground *= 0.9 + 0.1 * vnoise(vec2(uv.x * 40.0, depth * 90.0));`
    }
    col = ground;
  }
  col += mix(uAcc, vec3(1.0), 0.3) * exp(-abs(uv.y - hz) * uRes.y * 0.3) * (0.2 + 0.45 * light);
  return col;
}`,
      };
    }
    case "pillars": {
      const n = 1 + Math.floor(r() * 3);
      const w = 0.05 + r() * 0.04;
      return {
        recipe: `${n} 座背光的碑`,
        code: `
const float K_N = ${f(n)};
const float K_W = ${f(w)};
vec3 form(vec2 fc, vec2 uv, vec2 p) {
  float fy = aspect() < 0.8 ? (zoneCenter().y > 0.5 ? 0.1 : 0.42) : 0.18;
  float light = uParams.z;
  vec2 base = toP(vec2(focalUv().x, fy)) + vec2(mo().x, 0.0);
  float h = (aspect() < 0.8 ? 0.32 : 0.5) * K_SCALE * br();
  vec3 col = uBg * (0.5 + 0.3 * uv.y);
  float fog = smoothstep(fy + 0.2, fy - 0.05, uv.y) * (0.4 + 0.3 * fbm3(vec2(uv.x * 3.0 * aspect() + T() * 0.03, uv.y * 6.0)));
  col = mix(col, mix(uBg, uPri, 0.35), fog);
  vec2 lp = base + vec2(0.0, h * 0.75);
  float r = length(p - lp);
  vec3 lc = mix(uAcc, vec3(1.0), 0.4);
  float ang = atan(p.y - lp.y, p.x - lp.x);
  float rays = pow(vnoise(vec2(ang * 6.0 + uSeed, T() * 0.06)), 3.0) * exp(-r * 1.7) * smoothstep(1.5, 2.0, uMode) * (1.0 - step(2.5, uMode));
  col += lc * (exp(-r * (7.0 - 3.5 * light)) * (0.18 + 0.85 * light) + rays * (0.9 + 0.3 * kick()));
  float front = 0.0;
  float rim = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    if (fi >= K_N) break;
    float off = (fi - (K_N - 1.0) * 0.5) * K_W * 3.2;
    float spread = step(2.5, uMode) * (fi - (K_N - 1.0) * 0.5) * 0.05 * (0.5 + uSectionProgress);
    float hh = h * (1.0 - 0.18 * fi * step(1.5, K_N));
    vec2 c = base + vec2(off + spread, hh * 0.5);
    float d = sdBox(p - c, vec2(K_W, hh * 0.5));
    front = max(front, fill(d));
    rim = max(rim, exp(-abs(d) * (150.0 - 90.0 * uParams.x)));
  }
  col = mix(col, uBg * 0.16 + vec3(0.01), front);
  col += lc * rim * (1.0 - front * 0.7) * (0.15 + 0.85 * uParams.x) * (0.5 + 0.5 * light);
  gFront = front;
  vec2 dp = fc / min(uRes.x, uRes.y) * 80.0 + vec2(0.0, -T() * (0.2 + uParams.x));
  col += lc * step(0.986, hash12(floor(dp))) * smoothstep(0.4, 0.0, length(fract(dp) - 0.5)) * exp(-r * 1.6) * (0.1 + 0.5 * uParams.x);
  return col;
}`,
      };
    }
    case "orbits": {
      const rings = 3 + Math.floor(r() * 5);
      const tilt = 0.25 + r() * 0.5;
      const lean = (r() - 0.5) * 0.8;
      return {
        recipe: `${rings} 道傾斜的軌道與一顆星`,
        code: `
const float K_RINGS = ${f(rings)};
const float K_TILT = ${f(tilt)};
const float K_LEAN = ${f(lean)};
vec3 form(vec2 fc, vec2 uv, vec2 p) {
  float light = uParams.z;
  vec2 c = toP(focalUv()) + mo();
  vec3 col = mix(uBg * 0.6, uBg, uv.y) + uPri * 0.05 * (1.0 - length(p - c));
  vec2 sp = fc / min(uRes.x, uRes.y) * 200.0;
  col += vec3(0.8, 0.85, 1.0) * step(0.991, hash12(floor(sp))) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * 0.6;
  vec2 q = rot(K_LEAN) * (p - c);
  q.y /= K_TILT;
  float d = length(q);
  float pr = 0.06 * K_SCALE * br() * (0.8 + 0.4 * uParams.x);
  vec3 lc = mix(uAcc, vec3(1.0), 0.35);
  float lines = 0.0;
  float moons = 0.0;
  float collapse = step(2.5, uMode) * (0.35 + 0.4 * uSectionProgress);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    if (fi >= K_RINGS) break;
    float rr = (pr * 1.8 + fi * 0.055 * K_SCALE) * (1.0 - collapse * (fi / K_RINGS));
    float on = step(fi, K_RINGS * (0.35 + 0.65 * uParams.y));
    lines += stroke(d - rr, 0.0012 + 0.0008 * light) * on * (0.55 - 0.05 * fi);
    float a = T() * (0.05 + 0.03 * hash11(fi)) * (step(2.5, uMode) > 0.5 ? -1.0 : 1.0) + hash11(fi + 9.0) * TAU;
    vec2 mp = vec2(cos(a), sin(a)) * rr;
    moons += fill(length(q - mp) - 0.006) * on;
  }
  col += lc * lines * (0.5 + 0.6 * light);
  col = mix(col, lc, sat(moons));
  vec2 pq = p - c;
  float pd = length(pq);
  vec3 planet = mix(uBg * 0.3, mix(uPri, uAcc, 0.4), smoothstep(-0.6, 0.9, dot(normalize(pq + 1e-4), normalize(vec2(-0.6, 0.7))) * (pd / pr)));
  col += mix(uPri, uAcc, 0.5) * exp(-pd * 9.0) * (0.1 + 0.4 * light);
  col = mix(col, planet * (0.8 + 0.5 * light), fill(pd - pr));
  // rings pass in front of the planet on their near side
  float nearSide = step(0.0, -q.y) * fill(pd - pr);
  col += lc * lines * nearSide * 0.6;
  return col;
}`,
      };
    }
    case "strata": {
      const layers = 3 + Math.floor(r() * 4);
      const rough = 0.4 + r() * 0.6;
      const disc = r() < 0.6 ? 1 : 0;
      return {
        recipe: `${layers} 層${rough > 0.75 ? "嶙峋的" : "平緩的"}山脈${disc ? "與低低的日" : ""}`,
        code: `
const float K_LAYERS = ${f(layers)};
const float K_ROUGH = ${f(rough)};
const float K_DISC = ${f(disc)};
float ridge(float x, float k) {
  float v = fbm3(vec2(x * (1.4 + k * 0.6) + k * 7.3, k * 3.1 + uSeed * 0.01));
  return v * (0.6 + 0.4 * K_ROUGH) + (1.0 - abs(fract(x * (0.8 + k * 0.3)) * 2.0 - 1.0)) * 0.25 * K_ROUGH;
}
vec3 form(vec2 fc, vec2 uv, vec2 p) {
  float light = uParams.z;
  float hz = horizonY() + 0.12;
  vec3 col = mix(mix(uBg, uPri, 0.18 + 0.3 * light), uBg * 0.55, sat((uv.y - hz) / (1.0 - hz)));
  vec2 fu = focalUv();
  vec2 c = toP(vec2(fu.x, hz + 0.06 + 0.12 * uParams.x)) + mo();
  float dr = 0.07 * K_SCALE * br();
  if (K_DISC > 0.5) {
    float d = length(p - c);
    col += mix(uPri, uAcc, 0.5) * exp(-d * 6.0) * (0.12 + 0.35 * light);
    col = mix(col, mix(uAcc, vec3(1.0), 0.35), fill(d - dr));
  }
  float mirror = step(2.5, uMode);
  float y = uv.y;
  if (mirror > 0.5 && y < hz - 0.2) y = 2.0 * (hz - 0.2) - y;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi >= K_LAYERS) break;
    float k = fi / max(1.0, K_LAYERS - 1.0);
    float top = hz - k * 0.26 + (ridge(uv.x * aspect() + T() * 0.004 * (1.0 + fi), fi) - 0.5) * (0.14 + 0.08 * k) * K_SCALE;
    vec3 lc = mix(mix(uBg, uPri, 0.5 - 0.35 * k), uBg * (0.25 - 0.1 * k), k);
    float mist = exp(-max(0.0, top - y) * 18.0) * (0.35 - 0.2 * k) * (1.0 - 0.4 * light);
    col = mix(col, lc, step(y, top));
    col = mix(col, mix(uBg, uInk, 0.25), mist * step(y, top));
  }
  if (mirror > 0.5 && uv.y < hz - 0.2) col = mix(col * 0.55, uBg * 0.3, 0.3) + uAcc * 0.03 * vnoise(vec2(uv.x * 60.0, uv.y * 200.0 + T()));
  return col;
}`,
      };
    }
    case "bars": {
      const ang = 0.35 + r() * 0.75;
      const accentEvery = 3 + Math.floor(r() * 4);
      return {
        recipe: `傾斜 ${Math.round((ang * 180) / Math.PI)} 度的印刷斜線`,
        code: `
const float K_ANG = ${f(ang)};
const float K_ACC = ${f(accentEvery)};
vec3 form(vec2 fc, vec2 uv, vec2 p) {
  float upright = step(2.5, uMode);
  float open = step(1.5, uMode) * (1.0 - upright);
  float ang = mix(K_ANG, 1.5708, upright);
  vec2 r = rot(ang) * (p + mo());
  float freq = mix(5.0, 10.0, uParams.y) / K_SCALE;
  float s = r.x * freq;
  float id = floor(s);
  float duty = mix(0.26, 0.5, uParams.x);
  float present = step(0.3, hash11(id * 7.13 + uSeed));
  float shift = (hash11(id * 3.7 + floor(uBeatN * 0.5) * 1.3) - 0.5) * 0.5 * uReact * (1.0 - upright);
  float segF = mix(1.1, 2.4, uParams.w);
  float sy = r.y * segF + hash11(id) * 3.0 + shift;
  vec2 cr = vec2((id + duty * 0.5) / freq, (floor(sy) + 0.61 - hash11(id) * 3.0 - shift) / segF);
  vec2 cuv = ((rot(-ang) * cr - mo()) * min(uRes.x, uRes.y) + 0.5 * uRes) / uRes;
  float inZone = step(0.5, zoneMask(cuv, 0.0));
  float keep = mix(1.0 - inZone, 1.0 - inZone * step(0.5, hash11(id * 5.3 + floor(sy))), open);
  float bar = step(fract(s), duty) * present * step(0.2, fract(sy)) * keep;
  vec3 col = uBg * 0.92;
  float accent = step(K_ACC - 0.5, mod(id, K_ACC));
  col = mix(col, mix(uPri * (0.8 + 0.25 * uParams.z), uAcc, accent), bar);
  return col;
}`,
      };
    }
    case "brush": {
      const shape = r() < 0.55 ? 0 : 1;
      return {
        recipe: shape === 0 ? "一筆畫成的圓" : "一道橫掃的筆觸",
        code: `
const float K_SHAPE = ${f(shape)};
float brushAt(float t, float off, float w) {
  float edge = (vnoise(vec2(t * 90.0, sign(off) * 5.0)) - 0.5) * w * 0.45;
  float body = 1.0 - smoothstep(w * 0.7, w, abs(off) + edge);
  float across = off / max(w, 1e-4);
  float bristle = vnoise(vec2(t * 26.0, across * 9.0)) * 0.6 + vnoise(vec2(t * 70.0, across * 23.0)) * 0.4;
  float dryness = 0.15 + 0.7 * smoothstep(0.35, 1.0, t) + 0.2 * sat(across);
  return body * smoothstep(dryness - 0.1, dryness + 0.25, bristle + 0.2);
}
vec3 form(vec2 fc, vec2 uv, vec2 p) {
  float closeUp = step(1.5, uMode) * (1.0 - step(2.5, uMode));
  vec2 zc = zoneCenter();
  vec2 c = toP(mix(focalUv(), zc, closeUp * (1.0 - K_SHAPE))) + mo();
  float zr = 0.5 * max((uZone.z - uZone.x) * aspect(), uZone.w - uZone.y);
  float R = mix(0.24 * K_SCALE, zr * 1.05, closeUp * (1.0 - K_SHAPE));
  float sweep = min(uParams.x, 0.08 + 0.92 * smoothstep(0.0, 0.7, uSectionProgress)) * 0.97;
  vec3 col = uBg * (0.9 + 0.1 * vnoise(fc * 0.02));
  float wash = fbm(uv * vec2(aspect(), 1.0) * 2.0 + vec2(T() * 0.01, 0.0));
  col = mix(col, mix(uBg, uInk, 0.3), smoothstep(0.62, 0.0, length((uv - vec2(zc.x < 0.5 ? 1.0 : 0.0, 0.0)) * vec2(aspect(), 1.0)) - wash * 0.3) * (0.2 + 0.25 * uParams.y));
  float ink = 0.0;
  float w = R * (0.1 + 0.05 * uParams.y);
  if (uMode > 2.5) {
    float d = length(p - c);
    for (int i = 0; i < 4; i++) ink += stroke(d - R * (0.35 + 0.25 * float(i)), 0.0015) * (1.0 - 0.2 * float(i));
    ink *= 0.8;
  } else if (K_SHAPE < 0.5) {
    vec2 q = p - c;
    float t = fract((1.9 - atan(q.y, q.x)) / TAU);
    float press = smoothstep(0.0, 0.04, t) * (0.55 + 0.45 * sin(t * PI * 0.9 + 0.4)) * (1.0 - 0.7 * smoothstep(0.55, 1.0, t));
    ink = brushAt(t, length(q) - R * (1.0 + 0.03 * sin(t * 5.0 + uSeed)), w * (0.3 + 0.9 * press)) * step(t, sweep) * smoothstep(sweep, sweep - 0.02, t);
  } else {
    vec2 a = c - vec2(R * 1.6, 0.0);
    float t = sat((p.x - a.x) / (R * 3.2));
    float yy = a.y + sin(t * 3.1 + uSeed * 0.01) * R * 0.25 - t * R * 0.2;
    float press = smoothstep(0.0, 0.05, t) * (1.0 - 0.75 * smoothstep(0.5, 1.0, t));
    ink = brushAt(t, p.y - yy, w * 1.3 * (0.3 + 0.9 * press)) * step(t, sweep) * step(0.0005, t) * step(t, 0.9995);
  }
  col = mix(col, mix(uInk, vec3(1.0), 0.08) * (0.8 + 0.2 * uParams.z), ink);
  vec2 sun = c + vec2(R * 0.55, -R * 0.3);
  col = mix(col, uAcc, fill(length(p - sun) - (0.026 + 0.01 * uParams.z)));
  return col;
}`,
      };
    }
    case "ribbons": {
      const n = 2 + Math.floor(r() * 3);
      const freq = 1.2 + r() * 1.6;
      return {
        recipe: `${n} 條交錯的絲帶`,
        code: `
const float K_N = ${f(n)};
const float K_F = ${f(freq)};
vec3 form(vec2 fc, vec2 uv, vec2 p) {
  float light = uParams.z;
  vec2 fu = focalUv();
  vec3 col = mix(uBg * 0.6, uBg, uv.y);
  col += uPri * 0.08 * exp(-length(p - toP(fu)) * 2.5);
  float tight = step(2.5, uMode);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    if (fi >= K_N) break;
    float ph = hash11(fi * 3.1 + uSeed) * TAU;
    // each ribbon flows through the focal side of the frame, away from the words
    float cy = mix(fu.y - 0.18, fu.y + 0.18, fi / max(1.0, K_N - 1.0));
    float amp = (0.08 + 0.05 * uParams.x) * mix(1.0, 0.35, tight);
    float x = uv.x * aspect();
    float yc = cy + sin(x * K_F + ph + T() * 0.15) * amp + sin(x * K_F * 2.3 - T() * 0.1) * amp * 0.3;
    float slope = cos(x * K_F + ph + T() * 0.15) * amp * K_F;
    float wd = (0.012 + 0.03 * (0.5 + 0.5 * sin(x * 1.3 + ph))) * K_SCALE * br();
    float d = abs(uv.y - yc);
    float band = 1.0 - smoothstep(wd * 0.8, wd, d);
    float fold = 0.5 + 0.5 * sin(x * K_F * 2.0 + ph * 2.0 + slope * 3.0);
    vec3 rc = mix(mix(uPri, uAcc, fi / max(1.0, K_N)), mix(uAcc, vec3(1.0), 0.3), pow(fold, 3.0) * (0.3 + 0.6 * light));
    float fade = smoothstep(0.0, 0.25, abs(uv.x - (fu.x < 0.5 ? 1.0 : 0.0)));
    float away = 1.0 - zoneMask(uv, 0.08) * 0.97;
    col = mix(col, rc * (0.55 + 0.4 * fold), band * fade * away * (0.75 + 0.2 * uParams.y));
    col += rc * exp(-d / max(wd, 1e-3) * 1.5) * 0.06 * light * fade * away;
  }
  return col;
}`,
      };
    }
    default: {
      const density = 0.4 + r() * 0.6;
      return {
        recipe: `${density > 0.7 ? "密集的" : "稀疏的"}落下的光絲`,
        code: `
const float K_D = ${f(density)};
vec3 form(vec2 fc, vec2 uv, vec2 p) {
  float light = uParams.z;
  float floorY = aspect() < 0.8 ? 0.12 : 0.16;
  vec3 col = mix(uBg * 0.55, uBg, uv.y);
  float still = step(2.5, uMode);
  float cols = mix(60.0, 170.0, K_D * (0.4 + 0.6 * uParams.y)) * max(aspect(), 1.0);
  float x = uv.x * cols;
  float id = floor(x);
  float fx = fract(x);
  float speed = (0.25 + 0.6 * hash11(id)) * (1.0 - still * 0.97) * K_SPEED;
  float len = 0.08 + 0.25 * hash11(id + 3.0);
  float y = fract(uv.y * 0.6 + T() * speed * 0.2 + hash11(id + 7.0));
  float thread = smoothstep(0.08, 0.0, abs(fx - 0.5) - 0.02) * smoothstep(len, 0.0, y) * smoothstep(0.0, 0.02, y);
  float on = step(0.3, hash11(id * 1.37 + uSeed));
  // the words' window stays clear of rain
  float clear = 1.0 - zoneMask(uv, 0.05) * (1.0 - 0.5 * step(1.5, uMode));
  vec3 lc = mix(uPri, mix(uAcc, vec3(1.0), 0.4), 0.3 + 0.5 * light);
  col += lc * thread * on * clear * step(floorY, uv.y) * (0.7 + 0.8 * uParams.x);
  // ripples where the threads land
  vec2 rp = vec2((uv.x - 0.5) * aspect(), (uv.y - floorY) * 4.0);
  vec2 cell = floor(rp * vec2(6.0, 1.0));
  vec2 cc = (cell + 0.5 + (hash22(cell) - 0.5) * 0.6) / vec2(6.0, 1.0);
  float ph = fract(T() * 0.3 + hash12(cell));
  float ring = stroke(length((rp - cc) * vec2(1.0, 2.5)) - ph * 0.14, 0.003) * (1.0 - ph) * step(uv.y, floorY + 0.03);
  col += lc * ring * 0.5 * (1.0 - still);
  col = mix(col, uBg * 0.35, step(uv.y, floorY) * 0.6);
  col += lc * exp(-abs(uv.y - floorY) * uRes.y * 0.25) * 0.25 * (0.3 + light);
  return col;
}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// sections: modes, parameters, zones and relations
// ---------------------------------------------------------------------------

const RELATION_FOR_FORM: Record<FormId, TypeRelation> = {
  horizon: "lit",
  pillars: "behind",
  orbits: "lit",
  strata: "plain",
  bars: "knockout",
  brush: "knockout",
  ribbons: "lit",
  threads: "plain",
};

function zoneFor(side: "left" | "right" | "wide", kind: SectionKind, r: () => number): Zone {
  const w = side === "wide" ? 0.62 : 0.38 + r() * 0.08;
  const x = side === "left" ? 0.07 + r() * 0.03 : side === "right" ? 0.93 - w - r() * 0.03 : (1 - w) / 2;
  const quiet = kind === "intro" || kind === "outro" || kind === "breakdown";
  const y = quiet ? 0.3 + r() * 0.1 : 0.12 + r() * 0.08;
  const h = quiet ? 0.36 : 0.5 + r() * 0.08;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, w: Math.round(w * 1000) / 1000, h: Math.round(h * 1000) / 1000 };
}

function sectionStates(input: ComposerInput, choice: ComposerChoice, r: () => number): SceneProgramSection[] {
  const first: "left" | "right" = r() < 0.5 ? "left" : "right";
  const other = first === "left" ? "right" : "left";
  let verseSide = first;
  const out: SceneProgramSection[] = [];
  let prevKind: SectionKind | null = null;
  for (const s of input.sections) {
    const d = KIND_DEFAULTS[s.kind] ?? KIND_DEFAULTS.verse;
    const e = Math.min(1, Math.max(0, s.energy ?? 0.5));
    // the words change sides when the song turns a page: a verse after a chorus, the pre-chorus, the bridge
    let side: "left" | "right" | "wide";
    if (s.kind === "chorus") side = first;
    else if (s.kind === "bridge" || s.kind === "pre-chorus") side = other;
    else {
      if (s.kind === "verse" && prevKind === "chorus") verseSide = verseSide === first ? other : first;
      side = s.kind === "verse" ? verseSide : first;
    }
    const params = d.params.map((v, i) => Math.round(Math.min(1, Math.max(0, v * (i === 0 || i === 2 ? 0.75 + 0.5 * e : 1))) * 1000) / 1000);
    const relation: TypeRelation = s.kind === "chorus" || s.kind === "solo" ? RELATION_FOR_FORM[choice.form] : choice.form === "horizon" || choice.form === "orbits" ? "plain" : "plain";
    const note =
      s.kind === "chorus"
        ? `${FORM_LABELS[choice.form]}完全展開，字${relation === "lit" ? "被光照亮" : relation === "knockout" ? "從形狀裡挖空" : relation === "behind" ? "從形狀後面走過" : "留在空白裡"}`
        : s.kind === "bridge"
          ? `橋段換一個規則：${FORM_LABELS[choice.form]}變形`
          : s.kind === "verse"
            ? "畫面退後，字在留白的一側"
            : s.kind === "pre-chorus"
              ? "光慢慢打開，字換到另一側"
              : "只留一點點光";
    out.push({ sectionId: s.id, mode: d.mode, params, zone: zoneFor(side, s.kind, r), relation, note });
    prevKind = s.kind;
  }
  return out;
}

/** The offline composer's program for a song (deterministic). */
export function composeSceneProgram(input: ComposerInput): SceneProgram {
  const choice = chooseComposition(input);
  const r = rng((input.seed * 2654435761 + (input.salt ?? 0) * 97) >>> 0);
  const form = formGlsl(choice.form, r);
  const textureAmount = 0.3 + r() * 0.5;
  const source = `// ${input.title ?? ""} — 離線作曲器：${FORM_LABELS[choice.form]} × ${TEXTURE_LABELS[choice.texture]} × ${MOTION_LABELS[choice.motion]}
${COMMON(choice)}
${motionGlsl(choice.motion)}
${form.code}
${textureGlsl(choice.texture, textureAmount)}

vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = centered(fc);
  vec3 col = form(fc, uv, p);
  // a lit relation: the image's light gathers behind the words
  if (uRelation > 2.5) col += mix(uPri, uAcc, 0.6) * typeGlow(uv, 0.016) * 0.12;
  vec2 vq = (uv - 0.5) * vec2(aspect(), 1.0);
  col *= mix(0.7, 1.0, smoothstep(1.15, 0.3, length(vq)));
  return surface(col, fc, uv);
}
`;
  const title = input.title?.trim() ? `${FORM_LABELS[choice.form]}` : FORM_LABELS[choice.form];
  return {
    version: 1,
    engine: "offline",
    title,
    concept: `${form.recipe}，印在${TEXTURE_LABELS[choice.texture]}上，以${MOTION_LABELS[choice.motion]}的方式移動；形狀永遠站在字的另一側，主歌退後、副歌打開，橋段換一個規則。${input.world ? input.world : ""}`.slice(0, 400),
    source,
    sections: sectionStates(input, choice, r),
    keyMoment: null,
    enabled: true,
    recipe: `${choice.form}/${choice.texture}/${choice.motion}`,
  };
}
