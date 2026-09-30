// Section transition compositor: blends the outgoing (uB) and incoming (uA) scene
// renders. uKind: 1 fade, 2 flash, 3 wipe, 4 bloom. uP: 0..1 progress.

export const COMPOSITE_UNIFORMS = ["uRes", "uA", "uB", "uP", "uKind", "uAcc", "uClock"] as const;

export const COMPOSITE_FRAGMENT = /* glsl */ `
uniform vec2 uRes;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uP;
uniform float uKind;
uniform vec3 uAcc;
uniform float uClock;

#define PI 3.14159265

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

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  float p = clamp(uP, 0.0, 1.0);
  vec3 a = TEX(uA, uv).rgb;
  vec3 b = TEX(uB, uv).rgb;
  vec3 col;
  if (uKind < 1.5) {
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
    // wipe: soft diagonal edge with a glowing leading line
    vec2 dir = normalize(vec2(1.0, 0.3));
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    float extent = dot(vec2(aspect, 1.0) * 0.5, abs(dir));
    float e = dot(q, dir) / extent * 0.5 + 0.5;
    float soft = 0.05;
    float front = mix(-soft * 2.0, 1.0 + soft * 2.0, smoothstep(0.0, 1.0, p));
    float m = smoothstep(front + soft, front - soft, e);
    col = mix(b, a, m);
    float edge = exp(-abs(e - front) * 38.0) * sin(p * PI);
    col += mix(uAcc, vec3(1.0), 0.25) * edge * 0.85;
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
