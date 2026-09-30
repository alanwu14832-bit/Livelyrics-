// 字體藝術 (phase 6) type pass: composites the type layer (TypePainter's plates texture) over the
// rendered scene + band media, before the LED safety pass — so the brightness cap, the soften
// shoulder and the flash limiter's measurement all include the type.
//
// uType channels (premultiplied, as painted): r = ink plate (lyric colour), g = accent plate, b =
// spot plate (a knockout window mask, or the seal when uSeal = 1), a = the plates plus a soft halo
// around readable glyphs (a − max(r, g, b) is the halo).
//
// Effects: noise wobble (ink), glitch slices, RGB split, ink bleed (blur + noisy threshold), dry
// brush 飛白 streaks, erosion by the scene, grain, the legibility halo (darkens the scene under the
// text), glow (the halo turned to light), knockout (the frame filled, the scene seen only through
// the window glyphs, lifted so the letters read), overprint (a misregistered accent plate, screen).
// uLayer = 1 renders the type alone over transparent (premultiplied) for the export's lyric layer.
// 可讀性保證 (phase 7): for every relation the picture under a dilated mask of the readable glyphs
// is attenuated until the lyric colour meets the contrast target (legibility.ts).
// Common GLSL ES 1.00 / 3.00 subset.

import { LEGIBILITY_GLSL } from "./legibility";

export const TYPE_UNIFORMS = [
  "uRes",
  "uScene",
  "uType",
  "uInk",
  "uAccent",
  "uSpot",
  "uFill",
  "uAlpha",
  "uLayer",
  "uTime",
  "uSeed",
  "uGlitch",
  "uBleed",
  "uDry",
  "uWobble",
  "uRgb",
  "uGrain",
  "uEat",
  "uWindow",
  "uGlow",
  "uSeal",
  "uOverprint",
  "uVertical",
  "uHalo",
  "uPx",
  "uSoften",
  "uGain",
  "uRelation",
  "uTypeArea",
] as const;

export const TYPE_FRAGMENT = /* glsl */ `
uniform vec2 uRes;
uniform sampler2D uScene;
uniform sampler2D uType;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform vec3 uSpot;
uniform vec3 uFill;
uniform float uAlpha;     // lyrics-visible ramp
uniform float uLayer;     // 1 = the type alone over transparent (export)
uniform float uTime;
uniform float uSeed;
uniform float uGlitch;
uniform float uBleed;
uniform float uDry;
uniform float uWobble;
uniform float uRgb;
uniform float uGrain;
uniform float uEat;
uniform float uWindow;    // how much of the frame is filled around the window glyphs
uniform float uGlow;
uniform float uSeal;      // the spot plate is the seal colour
uniform float uOverprint;
uniform float uVertical;  // dry-brush streaks run down vertical text
uniform float uHalo;
uniform float uPx;        // canvas px per output px (effect radii follow the design)
uniform float uSoften;    // layer mode: the safety pass' soften and cap
uniform float uGain;
uniform float uRelation;  // 專屬畫面: 0 plain, 1 knockout, 2 behind, 3 lit (how the words meet the image)
uniform vec4 uTypeArea;   // where the type can be (uv, y up, padded): the legibility taps run only there

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 softenC(vec3 x, float s) {
  x = clamp(x, 0.0, 1.0);
  if (s <= 0.0) return x;
  float k = 1.0 - 0.55 * s;
  float top = 1.0 - 0.25 * s;
  float span = top - k;
  vec3 over = max(x - k, 0.0);
  vec3 rolled = k + span * (1.0 - exp(-over / span));
  return mix(x, rolled, step(vec3(k), x));
}

vec4 plates(vec2 uv) { return TEX(uType, clamp(uv, 0.0, 1.0)); }
${LEGIBILITY_GLSL}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / uRes;
  vec2 px = 1.0 / uRes;
  float s = max(uPx, 0.05);
  vec2 tuv = uv;
  // ink wobble: a slow low-frequency drift of the glyph edges
  if (uWobble > 0.001) {
    vec2 q = fc / (90.0 * s);
    tuv += (vec2(vnoise(q + uTime * 0.13), vnoise(q.yx - uTime * 0.11)) - 0.5) * uWobble * 3.2 * s * px;
  }
  // glitch slices: some horizontal bands jump sideways
  if (uGlitch > 0.001) {
    float band = floor(fc.y / (26.0 * s) + hash12(vec2(uSeed, 1.7)) * 9.0);
    float on = step(1.0 - 0.32 * uGlitch, hash12(vec2(band, uSeed + 0.37)));
    tuv.x += (hash12(vec2(band * 1.7, uSeed + 3.1)) - 0.5) * 0.05 * uGlitch * on;
  }
  vec4 T = plates(tuv);
  float ink = T.r;
  float acc = T.g;
  float spot = T.b;
  float halo = clamp(T.a - max(max(T.r, T.g), T.b), 0.0, 1.0);
  float inkR = ink;
  float inkB = ink;
  if (uRgb > 0.001) {
    vec2 o = vec2(uRgb * 7.0 * s * px.x, uRgb * 1.5 * s * px.y);
    inkR = plates(tuv + o).r;
    inkB = plates(tuv - o).r;
  }
  // ink bleed: blur, then a noisy threshold (the edge feathers like wet ink on paper)
  if (uBleed > 0.001) {
    vec2 r1 = 1.6 * s * px;
    float b = ink * 0.36;
    b += plates(tuv + vec2(r1.x, 0.0)).r * 0.16;
    b += plates(tuv - vec2(r1.x, 0.0)).r * 0.16;
    b += plates(tuv + vec2(0.0, r1.y)).r * 0.16;
    b += plates(tuv - vec2(0.0, r1.y)).r * 0.16;
    float th = 0.5 + (vnoise(fc / (5.0 * s)) - 0.5) * 0.5;
    float bled = smoothstep(th - 0.22, th + 0.16, b * 1.25);
    ink = mix(ink, max(ink * 0.85, bled), uBleed);
    inkR = mix(inkR, ink, uBleed);
    inkB = mix(inkB, ink, uBleed);
  }
  // dry brush (飛白): streaks along the stroke direction where the brush ran out of ink
  if (uDry > 0.001) {
    vec2 sp = uVertical > 0.5 ? vec2(fc.x / (2.2 * s), fc.y / (46.0 * s)) : vec2(fc.x / (46.0 * s), fc.y / (2.2 * s));
    float streak = vnoise(sp) * 0.7 + vnoise(sp * 2.3 + 7.0) * 0.3;
    float keep = mix(1.0, smoothstep(0.16, 0.5, streak + 0.12), uDry * 0.8);
    ink *= keep;
    inkR *= keep;
    inkB *= keep;
  }
  vec4 sceneA = TEX(uScene, uv);
  vec3 scene = sceneA.rgb;
  float keepF = 1.0;
  float haloRaw = halo;
  // behind: the scene program's foreground shape (1 - alpha) covers the words
  if (uRelation > 1.5 && uRelation < 2.5) {
    keepF = 1.0 - smoothstep(0.1, 0.9, 1.0 - sceneA.a);
    ink *= keepF;
    inkR *= keepF;
    inkB *= keepF;
    acc *= keepF;
    spot *= keepF;
    halo *= keepF;
  }
  // characters eaten by the scene: blocks of the glyphs give way where the picture is bright
  if (uEat > 0.001) {
    float blk = hash12(floor(fc / (16.0 * s)) + vec2(uSeed * 3.1, uSeed));
    float e = step(1.0 - uEat * 0.5, blk) * (0.55 + 0.45 * smoothstep(0.2, 0.7, luma(scene)));
    ink *= 1.0 - e;
    inkR *= 1.0 - e;
    inkB *= 1.0 - e;
    acc *= 1.0 - e * 0.8;
  }
  float a = clamp(uAlpha, 0.0, 1.0);
  ink *= a;
  inkR *= a;
  inkB *= a;
  acc *= a;
  spot *= a;
  halo *= a;
  float win = uSeal > 0.5 ? 0.0 : clamp(uWindow, 0.0, 1.0) * a;
  float windowMask = uSeal > 0.5 ? 0.0 : spot;
  float seal = uSeal > 0.5 ? spot : 0.0;
  float grain = (hash12(fc + fract(uTime * 7.3) * 91.0) - 0.5) * uGrain * 0.22;

  if (uLayer > 0.5) {
    // the type alone, premultiplied, for the export's lyric layer
    vec3 c = vec3(0.0);
    float al = 0.0;
    float fillA = win * (1.0 - windowMask);
    c = uFill * fillA;
    al = fillA;
    al = max(al, halo * uHalo * 0.6);
    c = c * (1.0 - acc) + uAccent * acc;
    al = max(al, acc);
    vec3 inkM = vec3(inkR, ink, inkB);
    c = c * (1.0 - inkM) + uInk * inkM;
    al = max(al, max(ink, max(inkR, inkB)));
    c = c * (1.0 - seal) + uSpot * seal;
    al = max(al, seal);
    c += grain * al;
    c = softenC(c / max(al, 1e-4), uSoften) * uGain * al;
    FRAG = vec4(clamp(c, 0.0, 1.0), clamp(al, 0.0, 1.0));
    return;
  }

  vec3 col = scene;
  float sl = luma(scene);
  vec3 inkC = uInk;
  float haloScale = 1.0;
  if (uRelation > 2.5) {
    // lit: the image lights the words (the letters take the hue and light of what is behind them)
    float m = max(max(scene.r, scene.g), max(scene.b, 0.04));
    vec3 hueC = scene / m;
    float lightK = smoothstep(0.04, 0.45, sl);
    inkC = mix(uInk, mix(uInk, hueC, 0.55) * (0.82 + 0.3 * lightK), 0.35 + 0.45 * lightK);
    inkC = mix(inkC, vec3(1.0), 0.12 * lightK);
  }
  bool inArea = uv.x >= uTypeArea.x && uv.y >= uTypeArea.y && uv.x <= uTypeArea.z && uv.y <= uTypeArea.w;
  if (inArea) inkC = legibleInk(inkC, uSoften, uGain);
  // the legibility halo: the stage darkens softly under readable text (no box, no scrim), more
  // where the picture is bright (light type on a light scene still reads from the back of the hall)
  float haloK = clamp(uHalo * (0.6 + 0.75 * smoothstep(0.25, 0.75, sl)), 0.0, 0.96) * haloScale;
  col = mix(col, uFill * 0.55 + col * 0.12, halo * haloK * (1.0 - uGlow));
  // the legibility guarantee: whatever the picture does under the words, the ink reads against it
  // (every relation: plain, lit, the uncovered part of behind, knockout)
  vec2 covers = inArea ? legibleCover(tuv, haloRaw) * a * keepF : vec2(0.0);
  float cover = covers.x;
  // knockout: the words cut a clean window out of the image's shapes — around the letters the
  // picture gives way to the background tone (a printed knockout), the letters keep the lyric colour
  if (uRelation > 0.5 && uRelation < 1.5) col = mix(col, uFill * 0.9 + col * 0.06, cover * 0.9);
  if (cover > 0.001) col = mix(col, legibleBg(col, inkC, uSoften, uGain), cover);
  // glow: the halo turned into light (bloom entrances, 光; a lit relation glows a little)
  col += inkC * halo * (uGlow * 0.55 + (uRelation > 2.5 ? 0.16 : 0.0));
  // knockout: the frame fills with the background, the scene is seen only through the glyphs
  if (win > 0.001) {
    vec3 fill = mix(scene * 0.16, uFill, 0.9);
    vec3 inside = min(vec3(1.0), scene * 1.3 + uAccent * 0.16 + 0.05);
    // the letters must read against the fill wherever the picture is as dark (or as light) as it:
    // there the ink colour comes through, the scene's texture still inside the letters
    float lf = luma(fill);
    float li = luma(inside);
    float need = lf < 0.5 ? clamp((lf + 0.42 - li) / 0.42, 0.0, 1.0) : clamp((li - lf + 0.42) / 0.42, 0.0, 1.0);
    inside = lf < 0.5 ? mix(inside, max(inside, uInk), need * 0.78) : mix(inside, inside * 0.22, need * 0.78);
    col = mix(col, fill, win * (1.0 - windowMask));
    col = mix(col, inside, windowMask);
  }
  // overprint: a misregistered accent plate screened over the picture
  if (uOverprint > 0.001) {
    float accO = plates(tuv + vec2(3.0 * s * px.x, -2.0 * s * px.y)).g * a;
    col = 1.0 - (1.0 - col) * (1.0 - uAccent * accO * uOverprint * 0.85);
    acc *= 1.0 - uOverprint * 0.35;
  }
  col = mix(col, uAccent, acc);
  // the type's own accent layers (a glitch echo stack, an overprint) behind the readable letters
  // meet the same contrast right around the letters (further out they keep their colour)
  float ghost = covers.y * min(1.0, acc * 3.0);
  if (ghost > 0.001) col = mix(col, legibleBg(col, inkC, uSoften, uGain), ghost);
  // the RGB split stays a fringe: the base glyph keeps (most of) the ink in every channel
  vec3 inkM = vec3(max(inkR, ink * 0.88), ink, max(inkB, ink * 0.88));
  col = col * (1.0 - inkM) + inkC * inkM;
  col = mix(col, uSpot, seal);
  col += grain * max(ink, acc);
  FRAG = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
