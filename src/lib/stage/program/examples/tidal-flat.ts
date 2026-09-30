import type { ExampleProgram } from "./types";

// 潮間帶: an acoustic folk ballad. A wide tidal flat at night under a small, low moon; water
// channels in the sand catch the light. The tide comes in with the chorus; the bridge stills the
// water into a mirror that doubles the sky.
export const TIDAL_FLAT: ExampleProgram = {
  id: "tidal-flat",
  title: "潮間帶",
  concept: "退潮後的潮間帶，一輪小小的月亮低低地掛在海上；主歌只有沙上幾道發亮的水痕，副歌潮水漫進來，橋段水面靜成一面鏡子，把天空整個倒過來。",
  brief: "民謠／原聲抒情，約 72 BPM，海、潮汐、月亮、回憶與離開的人",
  byKind: {
    intro: { mode: 0, params: [0.15, 0.25, 0.2, 0.2], zone: { x: 0.08, y: 0.5, w: 0.44, h: 0.34 }, relation: "plain", note: "只有月亮和霧" },
    verse: { mode: 0, params: [0.3, 0.35, 0.35, 0.3], zone: { x: 0.08, y: 0.48, w: 0.44, h: 0.36 }, relation: "plain", note: "退潮的沙地，字落在左下的暗處" },
    "pre-chorus": { mode: 1, params: [0.5, 0.5, 0.5, 0.45], zone: { x: 0.5, y: 0.48, w: 0.42, h: 0.36 }, relation: "lit", note: "霧散開，水痕變亮" },
    chorus: { mode: 2, params: [0.85, 0.8, 0.85, 0.6], zone: { x: 0.08, y: 0.46, w: 0.44, h: 0.38 }, relation: "lit", note: "潮水漫進來，月光鋪成一條路，照亮字" },
    bridge: { mode: 3, params: [0.6, 0.5, 0.6, 0.3], zone: { x: 0.5, y: 0.5, w: 0.42, h: 0.34 }, relation: "plain", note: "水面靜成鏡子，天空倒過來" },
    outro: { mode: 0, params: [0.2, 0.25, 0.25, 0.2], zone: { x: 0.08, y: 0.5, w: 0.44, h: 0.34 }, relation: "plain", note: "潮水退回去" },
  },
  source: /* glsl */ `
// 潮間帶 — a tidal flat under a low moon

float horizonY() {
  if (aspect() < 0.8) return zoneCenter().y > 0.5 ? 0.46 : 0.7;
  return 0.64;
}

vec3 skyAt(float y, float hz, float light) {
  float up = sat((y - hz) / (1.0 - hz));
  vec3 low = mix(uBg, mix(uPri, uInk, 0.3), 0.22 + 0.2 * light);
  return mix(low, uBg * 0.5, pow(up, 0.6));
}

vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = centered(fc);
  float hz = horizonY();
  float tide = uParams.x;
  float light = uParams.z;
  float mirror = step(2.5, uMode);
  // a small moon low over the sea, opposite the words
  float mx = aspect() < 0.8 ? 0.62 : (zoneCenter().x < 0.5 ? 0.72 : 0.28);
  vec2 mUv = vec2(mx, hz + 0.1 + 0.05 * light);
  vec2 mP = (mUv * uRes - 0.5 * uRes) / min(uRes.x, uRes.y);
  float mr = 0.03 + 0.008 * light;
  vec3 moonC = mix(uInk, vec3(1.0), 0.35);

  vec3 col;
  if (uv.y >= hz) {
    col = skyAt(uv.y, hz, light);
    // stars, few and quiet
    vec2 sp = fc / min(uRes.x, uRes.y) * 150.0;
    col += moonC * step(0.994, hash12(floor(sp))) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * 0.6 * sat((uv.y - hz) * 6.0);
    float d = length(p - mP);
    col += moonC * exp(-d * 9.0) * (0.12 + 0.25 * light);
    col = mix(col, moonC, fill(d - mr));
  } else {
    // perspective coordinates on the flat: rows crowd towards the horizon
    float depth = hz - uv.y;
    float z = 1.0 / (depth + 0.035);
    vec2 w = vec2((uv.x - 0.5) * aspect() * z * 0.5, z * 0.35);
    float drift = uTime * 0.02;
    float f = fbm(w * vec2(2.6, 1.5) + vec2(uSeed * 0.01, drift));
    // water channels: iso-bands of the noise, wider as the tide comes in (a flood in mode 2)
    float width = mix(0.018, 0.11, tide) + mirror * 0.5;
    float water = 1.0 - smoothstep(width * 0.7, width, abs(f - 0.5));
    water = max(water, mirror);
    // the wet sand, dark and warm, finer grain far away
    vec3 sand = mix(uBg * 0.9 + uPri * 0.04, uBg * 0.45, sat(depth * 1.8));
    sand *= 0.85 + 0.15 * vnoise(w * 6.0);
    // what the water reflects: the sky (mirrored), the moon's path of glints
    float ry = hz + (hz - uv.y) * (0.6 + 0.4 * mirror);
    vec3 refl = skyAt(ry, hz, light) * (0.55 + 0.35 * mirror);
    float dx = abs(uv.x - mx) * aspect();
    float path = exp(-dx * (9.0 - 5.0 * tide)) * (0.25 + 0.75 * light);
    float glint = smoothstep(0.55 - 0.15 * tide, 0.8 - 0.15 * tide, vnoise(vec2(w.x * 9.0, w.y * 3.0 + uTime * 0.25)));
    refl += moonC * path * (0.25 + glint) * 0.75;
    // the mirrored moon (bridge)
    vec2 mm = vec2(mP.x, (vec2(0.0, 2.0 * hz - mUv.y) * uRes - 0.5 * uRes).y / min(uRes.x, uRes.y));
    refl = mix(refl, moonC * 0.8, fill(length(p - mm) - mr) * mirror);
    col = mix(sand, refl, water * (0.7 + 0.3 * sat(depth * 4.0)));
  }
  // mist on the horizon line, thinning with the light
  float mist = exp(-abs(uv.y - hz) * (18.0 + 30.0 * light));
  col = mix(col, mix(uBg, moonC, 0.3), mist * (0.45 - 0.2 * light));
  // the words sit on the flat: under a lit relation the water around them brightens a little
  if (uRelation > 2.5) col += moonC * typeGlow(uv, 0.014) * 0.1;
  vec2 vq = (uv - 0.5) * vec2(aspect(), 1.0);
  col *= mix(0.68, 1.0, smoothstep(1.15, 0.3, length(vq)));
  col += grain(fc, 0.04) * (0.3 + luma(col));
  return col;
}
`,
};
