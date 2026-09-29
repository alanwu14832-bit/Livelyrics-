import type { ExampleProgram } from "./types";

// 碑: post-rock, long builds. One dark slab standing in fog beside the words, light held behind
// it. The build lets the light leak around its edges; the chorus opens it into rays; the bridge
// splits the slab down the middle. In the chorus the rays light the words beside the slab.
export const MONOLITH: ExampleProgram = {
  id: "monolith",
  title: "碑",
  concept: "霧裡立著一塊黑色的石碑，光一直被它擋在後面；漸強時光從邊緣滲出來，副歌變成放射的光束、照亮碑旁的字，橋段石碑從中間裂開。",
  brief: "後搖滾，約 90 BPM，長篇漸強、沉默與爆發、紀念與失去",
  byKind: {
    intro: { mode: 0, params: [0.1, 0.2, 0.1, 0.2], zone: { x: 0.08, y: 0.2, w: 0.36, h: 0.5 }, relation: "plain", note: "只有霧和石碑的輪廓" },
    verse: { mode: 0, params: [0.3, 0.35, 0.3, 0.35], zone: { x: 0.08, y: 0.18, w: 0.38, h: 0.52 }, relation: "plain", note: "光藏在碑後，字在左邊的霧裡" },
    "pre-chorus": { mode: 1, params: [0.55, 0.55, 0.55, 0.55], zone: { x: 0.08, y: 0.18, w: 0.4, h: 0.52 }, relation: "plain", note: "光從碑的邊緣滲出，塵埃上升" },
    chorus: { mode: 2, params: [0.9, 0.8, 0.9, 0.7], zone: { x: 0.1, y: 0.2, w: 0.46, h: 0.48 }, relation: "lit", note: "光束放射，照亮碑旁的字" },
    bridge: { mode: 3, params: [0.6, 0.5, 0.6, 0.4], zone: { x: 0.08, y: 0.18, w: 0.36, h: 0.5 }, relation: "plain", note: "石碑裂開，一道光從中間穿過" },
    outro: { mode: 0, params: [0.15, 0.2, 0.15, 0.2], zone: { x: 0.08, y: 0.22, w: 0.36, h: 0.46 }, relation: "plain", note: "光退回碑後" },
  },
  source: /* glsl */ `
// 碑 — a slab in fog, the light held behind it

vec2 uvToP(vec2 q) { return (q * uRes - 0.5 * uRes) / min(uRes.x, uRes.y); }

float floorY() { return aspect() < 0.8 ? (zoneCenter().y > 0.5 ? 0.1 : 0.42) : 0.2; }

vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = centered(fc);
  float build = uParams.x;
  float light = uParams.z;
  float fy = floorY();
  // the slab stands beside the words with clear air between them (it never touches their block)
  bool zoneLeft = zoneCenter().x < 0.5;
  float sxUv = aspect() < 0.8 ? 0.5 : (zoneLeft ? uZone.z + 0.06 : uZone.x - 0.06);
  vec2 base = uvToP(vec2(sxUv, fy));
  float halfW = 0.075;
  float h = aspect() < 0.8 ? 0.34 : 0.52;
  vec2 c = base + vec2(zoneLeft ? halfW : -halfW, h * 0.5);
  if (aspect() < 0.8) c.x = base.x;
  // the bridge splits the slab: two halves drift apart around a seam of light
  float split = step(2.5, uMode) * (0.012 + 0.03 * uParams.y) * (0.6 + 0.4 * uSectionProgress);
  vec2 q = p - c;
  float dL = sdBox(q + vec2(halfW * 0.5 + split, 0.0), vec2(halfW * 0.5, h * 0.5));
  float dR = sdBox(q - vec2(halfW * 0.5 + split, 0.0), vec2(halfW * 0.5, h * 0.5));
  float dSlab = split > 0.0 ? min(dL, dR) : sdBox(q, vec2(halfW, h * 0.5));
  vec2 lightP = c + vec2(0.0, h * 0.28);

  // the dark: deep background, a floor of fog
  vec3 col = uBg * (0.55 + 0.25 * uv.y);
  float fog = smoothstep(fy + 0.18, fy - 0.05, uv.y);
  float fogN = fbm3(vec2(uv.x * 3.0 * aspect() + uTime * 0.03, uv.y * 7.0 - uTime * 0.02));
  col = mix(col, mix(uBg, uPri, 0.35), fog * (0.35 + 0.35 * fogN));

  // the light behind the slab: a glow, then rays in the chorus
  vec2 lq = p - lightP;
  float r = length(lq);
  float glow = exp(-r * (7.0 - 3.5 * light)) * (0.2 + 0.9 * light + 0.15 * kick());
  float ang = atan(lq.y, lq.x);
  float rays = pow(vnoise(vec2(ang * 7.0 + uSeed, uTime * 0.08)), 3.0) * smoothstep(0.0, 0.15, r) * exp(-r * 1.6);
  float rayAmt = smoothstep(1.5, 2.0, uMode) * (1.0 - step(2.5, uMode));
  vec3 lc = mix(uAcc, vec3(1.0), 0.45);
  col += lc * (glow + rays * rayAmt * (1.1 + 0.4 * kick())) * (0.8 + 0.2 * build);
  // dust in the air, rising with the build
  vec2 dp = fc / min(uRes.x, uRes.y) * 90.0 + vec2(0.0, -uTime * (0.3 + build));
  float dust = step(0.985, hash12(floor(dp))) * smoothstep(0.4, 0.0, length(fract(dp) - 0.5));
  col += lc * dust * (0.1 + 0.5 * build) * exp(-r * 1.8);

  // the slab: nearly black stone, a rim of leaked light on its edges
  float slab = fill(dSlab);
  vec3 stone = uBg * 0.18 + vec3(0.012);
  float rim = exp(-abs(dSlab) * (140.0 - 80.0 * build)) * (0.15 + 0.85 * build);
  col = mix(col, stone, slab);
  col += lc * rim * (1.0 - slab * 0.7) * (0.5 + 0.5 * light);
  // the seam (bridge): light pours through the split
  float seam = step(2.5, uMode) * exp(-abs(q.x) * 90.0) * step(abs(q.y), h * 0.5);
  col += lc * seam * (0.8 + 0.4 * kick());
  // the slab is the foreground (the words pass behind it if the section is set to 在形狀後面)
  gFront = slab;
  // its reflection on the wet floor
  if (uv.y < fy) {
    vec2 rp = vec2(p.x, 2.0 * base.y - p.y);
    float rs = fill(min(sdBox(rp - c + vec2(halfW * 0.5 + split, 0.0), vec2(halfW * 0.5, h * 0.5)), sdBox(rp - c - vec2(halfW * 0.5 + split, 0.0), vec2(halfW * 0.5, h * 0.5))));
    col = mix(col, col * 0.55, rs * 0.6 * smoothstep(0.0, 0.1, fy - uv.y));
  }
  vec2 vq = (uv - 0.5) * vec2(aspect(), 1.0);
  col *= mix(0.6, 1.0, smoothstep(1.2, 0.25, length(vq)));
  col += grain(fc, 0.045) * (0.25 + luma(col));
  return col;
}
`,
};
