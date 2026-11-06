// Section transition compositor: blends the outgoing (uB) and incoming (uA) scene
// renders. uKind: 1 fade, 2 flash, 3 wipe, 4 bloom. uP: 0..1 progress.
// Round 22: uChar > 0 draws the song's own character instead (transition-look.ts: 1 dissolve,
// 2 swell, 3 cut, 4 scan, 5 tide, 6 sweep) with uAngle / uWidth / uTint / uRise.

export const COMPOSITE_UNIFORMS = ["uRes", "uA", "uB", "uP", "uKind", "uAcc", "uClock", "uChar", "uAngle", "uWidth", "uTint", "uRise"] as const;

/** Transition kinds as the shaders see them (0 = none; the type pass uses the same codes). */
export const TRANSITION_CODE = { fade: 1, flash: 2, wipe: 3, bloom: 4 } as const;

/**
 * The wipe's geometry, shared by the scene compositor and the type pass so the words are revealed
 * along the same edge as the picture: returns (e, front) — the pixel's position along the wipe
 * direction 0–1 and the edge's position at progress p (both overshoot by the soft width).
 */
export const WIPE_GLSL = /* glsl */ `
const float WIPE_SOFT = 0.07;
vec2 wipeFront(vec2 uv, float aspect, float p) {
  vec2 dir = normalize(vec2(1.0, 0.3));
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  float extent = dot(vec2(aspect, 1.0) * 0.5, abs(dir));
  float e = dot(q, dir) / extent * 0.5 + 0.5;
  float front = mix(-WIPE_SOFT * 2.0, 1.0 + WIPE_SOFT * 2.0, smoothstep(0.0, 1.0, p));
  return vec2(e, front);
}
`;

export const COMPOSITE_FRAGMENT = /* glsl */ `
uniform vec2 uRes;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uP;
uniform float uKind;
uniform vec3 uAcc;
uniform float uClock;
uniform float uChar;
uniform float uAngle;
uniform float uWidth;
uniform vec3 uTint;
uniform float uRise;

#define PI 3.14159265
${WIPE_GLSL}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 blurB(vec2 uv, float radius) {
  vec3 acc = TEX(uB, uv).rgb * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) / 8.0 * 6.2831853 + 0.4;
    vec2 o = vec2(cos(a), sin(a) * uRes.x / uRes.y) * radius;
    acc += TEX(uB, clamp(uv + o, 0.0, 1.0)).rgb * 0.1;
  }
  return acc;
}

// round 22: the song's character (see transition-look.ts). Light is added only when the energy rises
// (lift), never a full-field flash; a falling change dims.
vec3 character(vec2 uv, float aspect, float p, vec3 a, vec3 b) {
  float lift = smoothstep(0.05, 0.3, uRise);
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  float extent = dot(vec2(aspect, 1.0) * 0.5, abs(dir));
  float e = dot(q, dir) / extent * 0.5 + 0.5;
  float side = dot(q, vec2(-dir.y, dir.x));
  float bell = sin(p * PI);
  if (uChar < 1.5) {
    // dissolve: the old picture sinks, the new one rises out of a dimmer middle
    return mix(b, a, smoothstep(0.0, 1.0, p)) * (1.0 - 0.32 * bell);
  } else if (uChar < 2.5) {
    // swell: the old picture softens and breathes, the new one opens from a point the palette places
    vec2 c = dir * vec2(0.22 * aspect, 0.14);
    float r = length(q - c);
    vec3 bb = blurB(uv, bell * (0.004 + 0.012 * uWidth)) * (1.0 + bell * (0.1 + 0.25 * lift));
    float m = smoothstep(r - 0.06, r + 0.5, p * 1.8 - 0.25);
    vec3 col = mix(bb, a * (1.0 + bell * (0.04 + 0.14 * lift)), m);
    col += uTint * bell * (0.03 + 0.12 * lift) * exp(-r * 2.4);
    return col / (1.0 + max(col - 0.9, 0.0));
  } else if (uChar < 3.5) {
    // cut on the downbeat: the new picture at once, landing out of a slightly dimmer frame
    float k = step(0.015, p);
    return mix(b, a, k) * (1.0 - k * (0.22 + 0.1 * lift) * exp(-p * 10.0));
  } else if (uChar < 4.5) {
    // scanline wipe: rows reveal one after another, each with a thin scan line of the tint at its front
    float rows = floor(5.0 + uWidth * 19.0);
    float row = floor(uv.y * rows);
    float order = dir.x >= 0.0 ? (rows - 1.0 - row) / max(rows - 1.0, 1.0) : row / max(rows - 1.0, 1.0);
    float local = clamp((p - order * 0.45) / 0.55, 0.0, 1.0);
    float xx = dir.x >= 0.0 ? uv.x : 1.0 - uv.x;
    float front = local * 1.04 - 0.02;
    float m = step(xx, front);
    float inRow = step(0.001, local) * step(local, 0.999);
    float line = exp(-abs(xx - front) * 140.0) * inRow;
    float raster = 1.0 - 0.07 * bell * step(0.5, fract(gl_FragCoord.y * 0.5));
    vec3 col = mix(b, a * raster, m);
    return col + uTint * line * (0.12 + 0.45 * lift);
  } else if (uChar < 5.5) {
    // slow tide: a rolling front comes in from one side, a little foam of the tint on its crest
    float wave = 0.035 * sin(side * 9.0 + p * 5.0) + 0.02 * sin(side * 23.0 - p * 7.0);
    float front = mix(-0.2, 1.2, smoothstep(0.0, 1.0, p));
    float soft = 0.05 + 0.1 * uWidth;
    float m = smoothstep(front + soft, front - soft, e + wave);
    float foam = exp(-abs(e + wave - front) * 30.0) * bell;
    return mix(b, a, m) + uTint * foam * (0.05 + 0.22 * lift);
  }
  // sweep: an edge at the palette's angle, its light only as bright as the rise
  float soft = 0.03 + 0.08 * uWidth;
  float front = mix(-soft * 2.0, 1.0 + soft * 2.0, smoothstep(0.0, 1.0, p));
  float m = smoothstep(front + soft, front - soft, e);
  vec3 col = mix(b, a * (1.0 + 0.2 * lift * bell * exp(-max(front - e, 0.0) * 7.0)), m);
  col += uTint * exp(-abs(e - front) * (18.0 / (0.3 + uWidth))) * bell * (0.06 + 0.4 * lift);
  return col / (1.0 + max(col - 0.9, 0.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  float p = clamp(uP, 0.0, 1.0);
  vec3 a = TEX(uA, uv).rgb;
  vec3 b = TEX(uB, uv).rgb;
  vec3 col;
  if (uChar > 0.5) {
    col = character(uv, aspect, p, a, b);
  } else if (uKind < 1.5) {
    col = mix(b, a, smoothstep(0.0, 1.0, p));
  } else if (uKind < 2.5) {
    // flash: fast rise to an accent-tinted white, then reveal the new scene
    float peak = 0.12;
    float up = smoothstep(0.0, peak, p);
    float down = 1.0 - smoothstep(peak, 1.0, p);
    float amt = up * pow(down, 1.8);
    vec3 base = p < peak ? b : a;
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    vec3 fl = mix(vec3(1.0), uAcc, 0.3) * (1.05 - 0.3 * length(q));
    col = mix(base, fl, amt * 0.94);
  } else if (uKind < 3.5) {
    // wipe: a soft diagonal edge the new picture comes in behind, with a leading line of the
    // accent and a breath of light on the incoming side (round 12: an event you can see, not a swap)
    vec2 wf = wipeFront(uv, aspect, p);
    float e = wf.x;
    float front = wf.y;
    float m = smoothstep(front + WIPE_SOFT, front - WIPE_SOFT, e);
    float bell = sin(p * PI);
    vec3 lift = a * (1.0 + 0.22 * bell * exp(-max(front - e, 0.0) * 7.0));
    col = mix(b, lift, m);
    float edge = exp(-abs(e - front) * 32.0) * bell;
    col += mix(uAcc, vec3(1.0), 0.2) * edge * 0.5;
    col = col / (1.0 + max(col - 0.9, 0.0));
  } else {
    // bloom: the old scene blooms out, the new one opens from the centre
    float s = sin(p * PI);
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(q);
    vec3 bb = blurB(uv, s * 0.012) * (1.0 + s * 1.5);
    float open = p * 1.9 - 0.25;
    float m = smoothstep(r - 0.02, r + 0.28, open);
    col = mix(bb, a * (1.0 + s * 0.55), m);
    col += mix(uAcc, vec3(1.0), 0.4) * s * 0.22 * exp(-r * 2.2);
    col = col / (1.0 + max(col - 0.85, 0.0));
  }
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += (hash12(gl_FragCoord.xy + fract(uClock) * 97.0) - 0.5) * (1.5 / 255.0) * step(0.003, l);
  // the foreground mask (a scene program's alpha) cross-fades with the pictures
  FRAG = vec4(clamp(col, 0.0, 1.0), mix(TEX(uB, uv).a, TEX(uA, uv).a, clamp(uP, 0.0, 1.0)));
}
`;
