// Band-media compositor: draws up to two media layers (current + outgoing, cross-faded) over the
// rendered scene (uScene), under the DOM lyric layer. Every treatment is graded with its own
// section colorway so the band's material lives in the song's palette:
//   0 full · 1 duotone · 2 grain-film · 3 blur-glow · 4 halftone · 5 mask-lyrics · 6 slow-drift
//   7 beat-cut (framing / seeking happen on the CPU; the shader adds the beat punch)
// Blend: 0 normal · 1 screen · 2 multiply · 3 overlay. Common GLSL ES 1.00 / 3.00 subset.

export const MEDIA_UNIFORMS = [
  "uRes",
  "uScene",
  "uTime",
  "uLyricBox",
  "uLyricAmt",
  "uTexA",
  "uWA",
  "uModeA",
  "uUvA",
  "uSizeA",
  "uC0A",
  "uC1A",
  "uC2A",
  "uPunchA",
  "uSeedA",
  "uTexB",
  "uWB",
  "uModeB",
  "uUvB",
  "uSizeB",
  "uC0B",
  "uC1B",
  "uC2B",
  "uPunchB",
  "uSeedB",
] as const;

export const MEDIA_FRAGMENT = /* glsl */ `
uniform vec2 uRes;
uniform sampler2D uScene;
uniform float uTime;        // song time (deterministic grain / weave)
uniform vec4 uLyricBox;     // lyric area in screen uv: x0, y0, x1, y1
uniform float uLyricAmt;    // 0..1 a lyric line is on screen

uniform sampler2D uTexA;
uniform float uWA;          // weight (opacity x cross-fade), 0 = off
uniform vec4 uModeA;        // treatment, blend, contain (0/1), texture has mips (0/1)
uniform vec4 uUvA;          // scale.xy, offset.xy
uniform vec2 uSizeA;        // texture size in pixels
uniform vec3 uC0A;
uniform vec3 uC1A;
uniform vec3 uC2A;
uniform float uPunchA;      // beat punch 0..1
uniform float uSeedA;

uniform sampler2D uTexB;
uniform float uWB;
uniform vec4 uModeB;
uniform vec4 uUvB;
uniform vec2 uSizeB;
uniform vec3 uC0B;
uniform vec3 uC1B;
uniform vec3 uC2B;
uniform float uPunchB;
uniform float uSeedB;

#define PI 3.14159265

float sat(float x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// straight (non-premultiplied) sample; outside the texture (contain) fades to transparent
vec4 samp(sampler2D tex, vec2 uv, float contain) {
  vec4 c = TEX(tex, clamp(uv, 0.0, 1.0));
  if (contain > 0.5) {
    vec2 px = 1.5 / uRes;
    vec2 e = smoothstep(vec2(0.0), px, uv) * smoothstep(vec2(1.0), vec2(1.0) - px, uv);
    c.a *= e.x * e.y;
  }
  return c;
}

// soft disc blur: 16 golden-angle taps rotated per pixel (noise instead of banding), sampling a
// coarser mip level when the texture has mips (images) so wide radii stay smooth
vec4 blurred(sampler2D tex, vec2 uv, vec4 xf, float radius, float contain, float mips, vec2 size) {
  float aspect = uRes.x / uRes.y;
  // mipmapped images are smooth at the coarse level: no jitter; videos trade banding for fine noise
  float rot0 = mips > 0.5 ? 0.4 : hash12(gl_FragCoord.xy) * 6.2831853;
  // texels covered by one tap spacing -> mip bias
  float texR = radius * xf.y * size.y / 4.0;
  float bias = mips > 0.5 ? max(0.0, log2(max(texR, 1.0)) + 1.0) : 0.0;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float a = fi * 2.39996 + rot0;
    float r = sqrt((fi + 0.5) / 16.0) * radius;
    vec2 o = vec2(cos(a) / aspect, sin(a)) * r;
    vec2 tuv = uv + o * xf.xy;
    vec4 c = TEX(tex, clamp(tuv, 0.0, 1.0), bias);
    if (contain > 0.5) {
      vec2 e = step(vec2(0.0), tuv) * step(tuv, vec2(1.0));
      c.a *= e.x * e.y;
    }
    float w = 1.0 - 0.5 * (fi / 16.0);
    acc += c * w;
    wsum += w;
  }
  return acc / wsum;
}

vec3 duo(float l, vec3 c0, vec3 c1, vec3 c2) {
  float x = smoothstep(0.03, 0.97, l);
  vec3 c = mix(c0 * 0.85, c1, x);
  // a whisper of the accent in the very top highlights
  return mix(c, mix(c1, c2, 0.45) * 1.15 + 0.08, smoothstep(0.82, 1.0, l) * 0.35);
}

vec3 blendWith(vec3 s, vec3 m, float mode) {
  if (mode < 0.5) return m;
  if (mode < 1.5) return 1.0 - (1.0 - s) * (1.0 - m);
  if (mode < 2.5) return s * m;
  vec3 lo = 2.0 * s * m;
  vec3 hi = 1.0 - 2.0 * (1.0 - s) * (1.0 - m);
  return mix(lo, hi, step(0.5, s));
}

float boxMask(vec2 uv, vec4 box) {
  // soft rounded rectangle around the lyric area, a little larger than the box itself
  vec2 c = 0.5 * (box.xy + box.zw);
  vec2 h = 0.5 * (box.zw - box.xy) + vec2(0.04, 0.06);
  vec2 q = (uv - c) * vec2(uRes.x / uRes.y, 1.0);
  vec2 hh = h * vec2(uRes.x / uRes.y, 1.0);
  vec2 d = abs(q) - hh + 0.06;
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.06;
  return 1.0 - smoothstep(-0.02, 0.16, dist);
}

// one media layer over the scene colour s; returns the composited colour (weight applied by caller)
vec3 layer(vec3 s, vec2 suv, sampler2D tex, vec4 mode, vec4 xf, vec2 size, vec3 c0, vec3 c1, vec3 c2, float punch, float seed, out float alpha) {
  float treat = mode.x;
  float contain = mode.z;
  vec2 fc = gl_FragCoord.xy;
  float frame = floor(uTime * 24.0);

  vec2 uv = (suv - 0.5) * xf.xy + 0.5 + xf.zw;
  if (treat > 1.5 && treat < 2.5) {
    // grain-film: gate weave (tiny per-frame jitter)
    uv += (vec2(hash11(frame + seed), hash11(frame * 1.7 + seed + 3.1)) - 0.5) * vec2(0.0016, 0.0022);
  }
  vec4 src = samp(tex, uv, contain);
  vec3 c = src.rgb;
  float a = src.a;

  if (treat > 0.5 && treat < 1.5) {
    c = duo(luma(c), c0, c1, c2);
  } else if (treat < 2.5 && treat > 1.5) {
    float l = luma(c);
    vec3 g = mix(vec3(l), c, 0.3);
    // split tone: shadows into the background, highlights into the primary
    g = mix(g, g * (c0 * 1.6 + 0.25), 0.55 * (1.0 - l));
    g = mix(g, g * (0.6 + c1 * 0.7), 0.45 * l);
    g = smoothstep(0.03, 0.92, g);
    float n = hash12(fc * 0.73 + vec2(frame * 13.1, frame * 7.7));
    float n2 = hash12(floor(fc / 2.0) + vec2(frame * 3.3, 0.0));
    g += ((n + n2) * 0.5 - 0.5) * 0.16;
    g *= 1.0 + (hash11(frame + seed * 2.0) - 0.5) * 0.07;
    // dust: a few bright specks per frame
    float dust = step(0.9993, hash12(floor(fc / 3.0) + frame * 1.37));
    g += dust * 0.35;
    vec2 q = suv - 0.5;
    g *= mix(0.55, 1.0, smoothstep(0.85, 0.2, length(q * vec2(uRes.x / uRes.y * 0.7, 1.0))));
    c = g;
  } else if (treat > 2.5 && treat < 3.5) {
    vec4 b = blurred(tex, uv, xf, 0.03, contain, mode.w, size);
    vec4 b2 = blurred(tex, uv, xf, 0.1, contain, mode.w, size);
    vec3 glow = b2.rgb * b2.rgb * 1.4;
    c = mix(b.rgb, duo(luma(b.rgb), c0, c1, c2), 0.35) + glow * 0.45 * (c1 + 0.4);
    a = max(b.a, b2.a * 0.8);
  } else if (treat > 3.5 && treat < 4.5) {
    // halftone: 45-degree dot screen, dot area follows the luminance
    float cell = max(6.0, uRes.y / 92.0);
    vec2 p = rot(PI / 4.0) * fc;
    vec2 id = floor(p / cell);
    vec2 center = (id + 0.5) * cell;
    vec2 cfc = rot(-PI / 4.0) * center;
    vec2 cuv = (cfc / uRes - 0.5) * xf.xy + 0.5 + xf.zw;
    vec4 cs = samp(tex, cuv, contain);
    float l = luma(cs.rgb);
    float r = sqrt(sat(l)) * 0.62 * cell;
    float d = length(p - center);
    float dotm = 1.0 - smoothstep(r - 1.0, r + 1.0, d);
    c = mix(c0 * 0.9, mix(c1, c2, 0.2) * 1.05, dotm);
    a = cs.a;
  } else if (treat > 4.5 && treat < 5.5) {
    // mask-lyrics: the material stays, graded a little into the palette; where the lyrics sit
    // it recedes into the background tone while a line is on screen
    c = mix(c, duo(luma(c), c0, c1, c2), 0.35);
    float m = boxMask(suv, uLyricBox) * uLyricAmt;
    c = mix(c, c0 * 0.55 + c * 0.12, m * 0.88);
  } else if (treat > 5.5 && treat < 6.5) {
    // slow-drift: gentle grade so a raw photo still sits in the palette
    c = mix(c, duo(luma(c), c0, c1, c2), 0.18);
  } else if (treat > 6.5) {
    // beat-cut: punch on the beat (brightness + a touch of accent), slight grade
    c = mix(c, duo(luma(c), c0, c1, c2), 0.35);
    c *= 1.0 + punch * 0.45;
    c += c2 * punch * 0.12;
  }
  alpha = sat(a);
  return blendWith(s, max(c, 0.0), mode.y);
}

void main() {
  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 s = TEX(uScene, suv).rgb;
  vec3 col = s;
  if (uWA > 0.001) {
    float a;
    vec3 m = layer(s, suv, uTexA, uModeA, uUvA, uSizeA, uC0A, uC1A, uC2A, uPunchA, uSeedA, a);
    col += (mix(s, m, a) - s) * uWA;
  }
  if (uWB > 0.001) {
    float a;
    vec3 m = layer(s, suv, uTexB, uModeB, uUvB, uSizeB, uC0B, uC1B, uC2B, uPunchB, uSeedB, a);
    col += (mix(s, m, a) - s) * uWB;
  }
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (ign - 0.5) * (1.5 / 255.0);
  FRAG = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
