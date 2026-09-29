import type { ExampleProgram } from "./types";

// 墨: a slow ballad in the ink voice. One brush circle (圓相) drawn across each section with a dry
// brush, a small vermilion sun, ink wash rising from a corner. In the chorus the circle closes
// around the words and they are cut out of its stroke where they cross it.
export const ENSO: ExampleProgram = {
  id: "enso",
  title: "圓相",
  concept: "一筆畫出的圓，每一段慢慢寫完：主歌的圓只畫到一半、停在字旁邊；副歌這一筆把字整個圈起來，字從墨裡被挖空；橋段圓散成水面上的漣漪。",
  brief: "抒情慢歌／書法與水墨的字體語言，約 68 BPM，等待、圓滿、放下",
  byKind: {
    intro: { mode: 0, params: [0.35, 0.3, 0.2, 0.3], zone: { x: 0.1, y: 0.2, w: 0.36, h: 0.56 }, relation: "plain", note: "墨從右下角暈開" },
    verse: { mode: 0, params: [0.62, 0.4, 0.35, 0.4], zone: { x: 0.1, y: 0.16, w: 0.36, h: 0.6 }, relation: "plain", note: "圓畫到一半，停在字的右邊" },
    "pre-chorus": { mode: 1, params: [0.85, 0.55, 0.5, 0.5], zone: { x: 0.1, y: 0.16, w: 0.36, h: 0.6 }, relation: "plain", note: "這一筆快要畫完" },
    chorus: { mode: 2, params: [1.0, 0.75, 0.8, 0.6], zone: { x: 0.33, y: 0.26, w: 0.34, h: 0.48 }, relation: "knockout", note: "圓把字圈起來，字從墨裡挖空" },
    bridge: { mode: 3, params: [0.7, 0.5, 0.5, 0.4], zone: { x: 0.1, y: 0.18, w: 0.36, h: 0.56 }, relation: "plain", note: "圓散成漣漪" },
    outro: { mode: 0, params: [0.3, 0.3, 0.25, 0.25], zone: { x: 0.1, y: 0.2, w: 0.36, h: 0.56 }, relation: "plain", note: "只剩一個小小的朱紅日" },
  },
  source: /* glsl */ `
// 圓相 — one dry-brush circle per section

vec2 uvToP(vec2 q) { return (q * uRes - 0.5 * uRes) / min(uRes.x, uRes.y); }

// the brush stroke of a circle: coverage at p for a stroke that has been drawn up to "sweep"
float ensoStroke(vec2 p, vec2 c, float r, float a0, float sweep, float wide) {
  vec2 q = p - c;
  float a = atan(q.y, q.x);
  float t = fract((a0 - a) / TAU);
  float drawn = step(t, sweep);
  // pressure: the brush lands heavy, swells, then lifts and thins towards the end of the stroke
  float press = smoothstep(0.0, 0.04, t) * (0.55 + 0.45 * sin(t * PI * 0.9 + 0.4)) * (1.0 - 0.7 * smoothstep(0.55, 1.0, t));
  float w = r * wide * (0.3 + 0.9 * press) * (0.8 + 0.4 * vnoise(vec2(t * 7.0, 3.0)));
  float rr = r * (1.0 + 0.035 * sin(t * 5.0 + uSeed) + 0.02 * (vnoise(vec2(t * 3.0, 9.0)) - 0.5));
  float off = length(q) - rr;
  // ragged edges: the paper takes the ink unevenly
  float edge = (vnoise(vec2(t * 90.0, sign(off) * 5.0)) - 0.5) * w * 0.45;
  float body = 1.0 - smoothstep(w * 0.7, w, abs(off) + edge);
  // dry brush: long bristle streaks along the stroke, dryer towards its end and its outer side
  float across = off / max(w, 1e-4);
  float bristle = vnoise(vec2(t * 26.0, across * 9.0)) * 0.6 + vnoise(vec2(t * 70.0, across * 23.0)) * 0.4;
  float dryness = 0.15 + 0.7 * smoothstep(0.35, 1.0, t) + 0.2 * sat(across);
  float dry = smoothstep(dryness - 0.1, dryness + 0.25, bristle + 0.2);
  // the end of the stroke as it is being drawn: a soft brush tip
  float tip = smoothstep(sweep, sweep - 0.02, t);
  return body * dry * drawn * tip;
}

vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = centered(fc);
  float closeUp = step(1.5, uMode) * (1.0 - step(2.5, uMode));
  // the circle: beside the words (verse), around them (chorus)
  vec2 zc = zoneCenter();
  vec2 opp = aspect() < 0.8 ? vec2(0.5, 1.0 - zc.y) : vec2(zc.x < 0.5 ? 0.7 : 0.3, 0.5);
  vec2 cUv = mix(opp, zc, closeUp);
  vec2 c = uvToP(cUv);
  float zr = 0.5 * max((uZone.z - uZone.x) * aspect(), uZone.w - uZone.y);
  float r = mix(aspect() < 0.8 ? 0.3 : 0.26, zr * 1.05, closeUp);
  // the stroke is written across the section (the first beats land the brush)
  float sweep = min(uParams.x, 0.08 + 0.92 * smoothstep(0.0, 0.7, uSectionProgress)) * 0.97;

  // night paper: a dark warm ground with fibre
  vec3 paper = uBg * (0.9 + 0.1 * vnoise(fc * 0.02)) + vec3(0.01, 0.008, 0.004);
  float fibre = vnoise(vec2(fc.x * 0.012, fc.y * 0.3)) * vnoise(vec2(fc.x * 0.3, fc.y * 0.012));
  vec3 col = paper + uInk * fibre * 0.025;
  // ink wash rising from the corner away from the words
  vec2 wc = vec2(zc.x < 0.5 ? 1.0 : 0.0, 0.0);
  float wash = fbm(uv * vec2(aspect(), 1.0) * 2.2 + vec2(uTime * 0.01, -uTime * 0.015));
  float washMask = smoothstep(0.75, 0.0, length((uv - wc) * vec2(aspect(), 1.0)) - wash * 0.35);
  vec3 inkPale = mix(uBg, uInk, 0.42);
  col = mix(col, mix(col, inkPale * 0.6, 0.7), washMask * (0.25 + 0.3 * uParams.y));

  float ink = 0.0;
  if (uMode > 2.5) {
    // bridge: the circle dissolves into ripples spreading from its centre
    float d = length(p - c);
    float ring = 0.0;
    for (int i = 0; i < 4; i++) {
      float rr = r * (0.35 + 0.28 * float(i)) + 0.02 * sin(uTime * 0.4 + float(i));
      ring += stroke(d - rr, 0.0015 + 0.001 * float(i)) * (1.0 - 0.2 * float(i));
    }
    ink = ring * 0.8;
  } else {
    ink = ensoStroke(p, c, r, 1.9 + uSeed * 0.001, sweep, 0.1 + 0.05 * uParams.y);
    // a few round droplets thrown off where the brush landed (the chorus is written harder)
    vec2 g = (p - c) * 22.0;
    vec2 cell = floor(g);
    vec2 jit = hash22(cell + uSeed);
    float dropR = 0.08 + 0.18 * hash12(cell + 7.0);
    float drop = fill(length(fract(g) - jit) - dropR) * step(0.93, hash12(cell + 3.0));
    float nearStart = smoothstep(r * 0.55, 0.0, length(p - c - r * vec2(cos(1.9), sin(1.9))));
    ink = max(ink, drop * nearStart * step(0.5, uParams.y) * 0.85);
  }
  vec3 inkC = mix(uInk, vec3(1.0), 0.1) * (0.82 + 0.18 * uParams.z);
  col = mix(col, inkC, ink);

  // the vermilion sun (a seal of light), small, inside or beside the circle
  vec2 sunP = c + vec2(r * 0.52, -r * 0.34) * (1.0 - closeUp) + vec2(r * 0.62, r * 0.55) * closeUp;
  float sd = length(p - sunP);
  float sunR = 0.03 + 0.012 * uParams.z + 0.004 * kick();
  col = mix(col, uAcc, fill(sd - sunR) * (0.85 + 0.15 * uParams.z));
  col += uAcc * exp(-sd * 22.0) * 0.12 * uParams.z;

  vec2 vq = (uv - 0.5) * vec2(aspect(), 1.0);
  col *= mix(0.78, 1.0, smoothstep(1.2, 0.35, length(vq)));
  col += grain(fc, 0.05) * (0.3 + luma(col));
  return col;
}
`,
};
