import type { ExampleProgram } from "./types";

// 訊號: fast post-punk / electronic. A screen-printed poster of heavy diagonal bars over halftone,
// the bars broken into segments that jump on the beat (position, never brightness: no strobe).
// The verse keeps the bars out of the words' block; the chorus runs them through it and the
// words are cut out of the bars; the bridge turns the bars upright and quiet.
export const SIGNAL: ExampleProgram = {
  id: "signal",
  title: "訊號",
  concept: "一張網版印刷的海報：粗斜線壓在網點上，線段隨拍點跳位（只換位置、不閃）；主歌斜線讓出左邊給字，副歌斜線穿過字、字從線條裡被挖空，橋段線條轉成直立、安靜下來。",
  brief: "後龐克／電子，約 160 BPM，都市的噪音、訊號、反抗與速度",
  byKind: {
    intro: { mode: 0, params: [0.3, 0.35, 0.3, 0.3], zone: { x: 0.07, y: 0.16, w: 0.38, h: 0.56 }, relation: "plain", note: "斜線從右邊進場" },
    verse: { mode: 0, params: [0.5, 0.45, 0.45, 0.5], zone: { x: 0.07, y: 0.14, w: 0.38, h: 0.58 }, relation: "plain", note: "斜線讓出左邊的字塊" },
    "pre-chorus": { mode: 1, params: [0.7, 0.6, 0.6, 0.7], zone: { x: 0.55, y: 0.14, w: 0.38, h: 0.58 }, relation: "plain", note: "斜線換邊、加密" },
    chorus: { mode: 2, params: [1.0, 0.8, 0.8, 0.9], zone: { x: 0.08, y: 0.18, w: 0.5, h: 0.52 }, relation: "knockout", note: "斜線穿過字，字從線條裡挖空" },
    bridge: { mode: 3, params: [0.4, 0.3, 0.35, 0.3], zone: { x: 0.08, y: 0.2, w: 0.4, h: 0.5 }, relation: "plain", note: "線條轉直、變安靜" },
    outro: { mode: 0, params: [0.25, 0.3, 0.3, 0.2], zone: { x: 0.07, y: 0.16, w: 0.38, h: 0.56 }, relation: "plain", note: "線條一根根退出" },
  },
  source: /* glsl */ `
// 訊號 — screen-printed bars over halftone, segments that jump on the beat

vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = centered(fc);
  float upright = step(2.5, uMode);
  float open = step(1.5, uMode) * (1.0 - upright);
  float ang = mix(0.52, 1.5708, upright);
  vec2 r = rot(ang) * p;
  float freq = mix(6.0, 10.0, uParams.y) * mix(1.0, 0.7, upright);
  float s = r.x * freq;
  float id = floor(s);
  float within = fract(s);
  float duty = mix(0.28, 0.5, uParams.x);
  float present = step(0.28, hash11(id * 7.13 + uSeed));
  // segments along each bar; they shift on every other beat (a jump in position only)
  float step2 = floor(uBeatN * 0.5);
  float shift = (hash11(id * 3.7 + step2 * 1.3) - 0.5) * 0.6 * uReact * (1.0 - upright);
  float segF = mix(1.2, 2.6, uParams.w);
  float sy = r.y * segF + hash11(id) * 3.0 + shift;
  float seg = fract(sy);
  float segOn = step(0.22, seg);
  // each segment is kept or dropped whole, by where its centre falls: out of the words' block in
  // the verse (clean cut ends, like a printed poster), through it in the chorus (fewer there)
  vec2 cr = vec2((id + duty * 0.5) / freq, (floor(sy) + 0.61 - hash11(id) * 3.0 - shift) / segF);
  vec2 cp = rot(-ang) * cr;
  vec2 cuv = (cp * min(uRes.x, uRes.y) + 0.5 * uRes) / uRes;
  float inZone = step(0.5, zoneMask(cuv, 0.0));
  float keepSeg = mix(1.0 - inZone, 1.0 - inZone * step(0.5, hash11(id * 5.3 + floor(sy))), open);
  // on a landscape frame the verse's bars also thin out towards the words' side
  float gap = zoneCenter().x < 0.5 ? cuv.x - uZone.z : uZone.x - cuv.x;
  float thin = aspect() < 0.8 ? 1.0 : step(hash11(id * 2.1 + floor(sy) * 1.7), gap * 4.0 + 0.2);
  keepSeg *= mix(thin, 1.0, open);
  float bar = step(within, duty) * present * segOn * keepSeg;
  float field = keepSeg;

  // the ground: ink-dark paper and a halftone that thickens along the diagonal
  vec3 col = uBg * 0.9;
  float g = sat(0.5 + dot(p, vec2(0.55, -0.35)));
  vec2 cell = fc / (min(uRes.x, uRes.y) * 0.011);
  vec2 cf = fract(cell) - 0.5;
  float dot_ = 1.0 - smoothstep(0.0, 0.08, length(cf) - 0.42 * g * (0.4 + 0.6 * uParams.z));
  col = mix(col, mix(uBg, uPri, 0.35), dot_ * 0.55);
  // the bars: primary, every fifth one the accent, a slight misregistration of the second ink
  vec3 inkA = uPri * (0.8 + 0.25 * uParams.z);
  vec3 inkB = uAcc;
  float accentBar = step(0.8, hash11(id * 1.91 + 4.0));
  col = mix(col, mix(inkA, inkB, accentBar), bar);
  float off = step(fract((r.x + 0.004) * freq), duty) * present * segOn * accentBar * field;
  col = mix(col, inkB * 0.85, off * (1.0 - bar) * 0.8);
  // a scan band crawling down, like a signal line on a monitor
  float band = exp(-abs(uv.y - fract(1.0 - uTime * 0.04)) * 60.0);
  col += uAcc * band * 0.06 * (1.0 - upright);
  // paper grain
  col += grain(fc, 0.06) * (0.4 + luma(col));
  return col;
}
`,
};
