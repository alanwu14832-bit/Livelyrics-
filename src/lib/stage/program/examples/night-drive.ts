import type { ExampleProgram } from "./types";

// 夜航: city pop / synth-pop at night. One setting sun on a low horizon, a city line in front of it
// and its reflection on the water. The text lives in the sky on the side the sun is not.
export const NIGHT_DRIVE: ExampleProgram = {
  id: "night-drive",
  title: "夜航",
  concept: "一顆沉進海裡的夕陽，城市的剪影擋在它前面；主歌只剩地平線的一道光，副歌太陽升起、倒影拉長，橋段它變成日蝕的一圈光。",
  brief: "city pop／合成器流行，約 110 BPM，夜晚開車、城市、海、霓虹與懷舊",
  byKind: {
    intro: { mode: 0, params: [0.05, 0.2, 0.15, 0.2], zone: { x: 0.08, y: 0.14, w: 0.4, h: 0.44 }, relation: "plain", note: "只有地平線上的一道暖光" },
    verse: { mode: 0, params: [0.25, 0.35, 0.3, 0.35], zone: { x: 0.08, y: 0.12, w: 0.42, h: 0.46 }, relation: "plain", note: "太陽半沉，字在左上的夜空" },
    "pre-chorus": { mode: 1, params: [0.55, 0.5, 0.55, 0.5], zone: { x: 0.5, y: 0.12, w: 0.42, h: 0.46 }, relation: "plain", note: "太陽開始升起，字換到右邊" },
    chorus: { mode: 2, params: [0.95, 0.75, 0.9, 0.7], zone: { x: 0.08, y: 0.1, w: 0.42, h: 0.48 }, relation: "lit", note: "太陽完全升起，倒影鋪滿海面，字被陽光照亮" },
    bridge: { mode: 3, params: [0.7, 0.4, 0.45, 0.4], zone: { x: 0.5, y: 0.12, w: 0.42, h: 0.46 }, relation: "plain", note: "日蝕：只剩一圈光，城市熄燈" },
    solo: { mode: 2, params: [0.85, 0.9, 0.8, 0.9], zone: { x: 0.08, y: 0.12, w: 0.42, h: 0.46 }, relation: "lit", note: "倒影隨節拍閃動" },
    outro: { mode: 0, params: [0.1, 0.2, 0.2, 0.2], zone: { x: 0.08, y: 0.14, w: 0.42, h: 0.44 }, relation: "plain", note: "太陽沉下去，只剩城市的燈" },
  },
  source: /* glsl */ `
// 夜航 — the sun sets into a night sea behind a city line

float horizon() {
  // tall canvas: the horizon moves to the half the text is not in
  if (aspect() < 0.8) return zoneCenter().y > 0.5 ? 0.3 : 0.56;
  return 0.36;
}

vec2 toP(vec2 uvp) { return (uvp * uRes - 0.5 * uRes) / min(uRes.x, uRes.y); }

float skyline(float x, float hz, float sx) {
  // one cluster of towers around the sun, the rest of the horizon left clean
  float cells = 90.0 * max(aspect(), 1.0);
  float c = floor(x * cells);
  float h = hash11(c * 1.37 + 11.0);
  float slim = step(0.35, hash11(c * 3.1 + 2.0));
  float tall = (pow(h, 2.2) * 0.085 + 0.004) * slim;
  float cluster = smoothstep(0.34, 0.06, abs(x - sx));
  return hz + tall * cluster * (0.6 + 0.4 * uParams.y);
}

vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = centered(fc);
  float hz = horizon();
  float rise = uParams.x;
  float light = uParams.z;
  // the sun sits opposite the words
  float sx = aspect() < 0.8 ? 0.5 : (zoneCenter().x < 0.5 ? 0.7 : 0.3);
  float r = (0.17 + 0.07 * uParams.y) * (aspect() < 0.8 ? 1.25 : 1.0);
  vec2 hzP = toP(vec2(sx, hz));
  vec2 sc = hzP + vec2(0.0, r * (rise * 1.25 - 0.55));
  vec2 q = p - sc;
  float d = length(q);

  // sky: deep at the top, warm towards the horizon
  float up = sat((uv.y - hz) / (1.0 - hz));
  vec3 sky = mix(mix(uBg, uPri, 0.28 + 0.2 * light), uBg * 0.55, pow(up, 0.7));
  vec3 col = sky;
  // stars in the high sky, gone when the sun is up
  vec2 sp = fc / min(uRes.x, uRes.y) * 180.0;
  float st = step(0.992, hash12(floor(sp))) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5));
  col += vec3(0.8, 0.85, 1.0) * st * smoothstep(0.2, 0.7, up) * (1.0 - 0.8 * light) * (0.6 + 0.4 * sin(uClock * 1.3 + hash12(floor(sp)) * 20.0));
  // haze around the sun
  col += mix(uPri, uAcc, 0.5) * exp(-d * (5.0 - 2.0 * light)) * (0.18 + 0.4 * light + 0.12 * kick());

  // the sun: a vertical gradient disc, slit by bands in its lower half (bridge: an eclipse ring)
  vec3 sunTop = mix(uAcc, vec3(1.0), 0.35);
  vec3 sunBot = mix(uPri, uAcc, 0.25);
  float ny = q.y / r;
  vec3 sun = mix(sunBot, sunTop, smoothstep(-1.0, 0.9, ny));
  float bandN = 7.0;
  float bandPos = fract((0.35 - ny) * bandN * 0.5 + uTime * 0.03);
  float bandW = sat((0.2 - ny) * 0.55);
  float cut = step(bandPos, bandW) * step(ny, 0.2);
  float disc = fill(d - r) * (1.0 - cut);
  if (uMode > 2.5) {
    float ring = stroke(d - r, 0.004 + 0.004 * light) + exp(-abs(d - r) * 60.0) * 0.6;
    col = mix(col, uBg * 0.35, fill(d - r));
    col += sunTop * ring * (0.8 + 0.3 * kick());
  } else {
    col = mix(col, sun * (0.75 + 0.45 * light), disc * step(hz, uv.y + 0.0005));
  }

  // the city line in front of the sun, windows lit at random, fewer when the sun is high
  float sky_h = skyline(uv.x, hz, sx);
  float bld = step(uv.y, sky_h) * step(hz, uv.y);
  vec2 wc = floor(fc / (min(uRes.x, uRes.y) * vec2(0.0035, 0.006)));
  float win = step(0.9 - 0.08 * uParams.w, hash12(wc + 3.0)) * step(uv.y, sky_h - 0.008);
  win *= 0.6 + 0.4 * sin(uClock * 0.7 + hash12(wc) * 30.0);
  vec3 city = uBg * 0.3 + uAcc * win * (uMode > 2.5 ? 0.05 : 0.55) * (1.0 - 0.5 * light);
  col = mix(col, city, bld);

  // the sea: dark water, the sun's broken reflection under it
  if (uv.y < hz) {
    float depth = sat((hz - uv.y) / hz);
    vec3 sea = mix(uBg * 0.55 + uPri * 0.08, uBg * 0.25, pow(depth, 0.6));
    float lanes = pow(depth, 0.45) * 90.0;
    float rip = fract(lanes - uTime * 0.35 + vnoise(vec2(uv.x * 30.0, lanes * 0.5)) * 0.6);
    float wid = r * (0.55 + 0.9 * rise) * (1.0 + depth * 0.6) * (0.75 + 0.35 * vnoise(vec2(lanes * 0.7, uTime * 0.2)));
    float refl = (1.0 - smoothstep(wid * 0.6, wid, abs(p.x - sc.x))) * step(0.45, rip) * (1.0 - depth * (1.1 - rise));
    float on = uMode > 2.5 ? 0.25 : 1.0;
    sea += sun * refl * (0.25 + 0.6 * light) * on * (0.85 + 0.25 * kick());
    col = sea;
  }
  // a thin line of light on the horizon
  col += mix(uAcc, vec3(1.0), 0.3) * exp(-abs(uv.y - hz) * uRes.y * 0.35) * (0.25 + 0.5 * light);

  // light behind the words when the sun lights them
  if (uRelation > 2.5) col += mix(uPri, uAcc, 0.6) * typeGlow(uv, 0.018) * 0.16;

  // print grain and a soft vignette
  vec2 vq = (uv - 0.5) * vec2(aspect(), 1.0);
  col *= mix(0.72, 1.0, smoothstep(1.1, 0.3, length(vq)));
  col += grain(fc, 0.03) * (0.4 + luma(col));
  return col;
}
`,
};
