// particles — a deep field of drifting light particles that swell on the beat.
export const particles = /* glsl */ `
vec3 particleLayer(vec2 p, float z, float seed, float k) {
  float cells = mix(5.0, 11.0, uDensity);
  vec2 g = p * cells * z;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 h = hash22(id + seed);
  float present = step(0.25 - uDensity * 0.2, hash12(id * 1.31 + seed));
  vec2 o = (h - 0.5) * 0.5;
  float d = length(f - o);
  float size = mix(0.035, 0.09, hash12(id + seed * 2.3)) * (1.0 + 0.9 * k);
  float core = exp(-d * d / (size * size * 0.35));
  float halo = size * 0.18 / (d * d + size * 0.18) * smoothstep(0.5, 0.18, d) * 0.55;
  float tw = 0.65 + 0.35 * sin(uClock * (1.2 + h.x * 2.5) + h.y * TAU);
  vec3 c = mix(uPri, uAcc, step(0.68, h.y));
  c = mix(c, vec3(1.0), core * 0.45);
  return c * (core + halo) * tw * present;
}

vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  float k = kick();
  float r = length(p);
  // background: deep gradient + faint haze
  vec3 col = mix(uBg * 1.25, uBg * 0.55, sat(r * 1.3));
  float haze = fbm3(p * 2.2 + vec2(uTime * 0.04, -uTime * 0.03) + uSeed);
  col += uPri * smoothstep(0.45, 1.0, haze) * 0.16;

  vec2 pr = rot(uTime * 0.025) * p;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float depth = fract(fi / 5.0 + uTime * 0.035);
    float z = mix(2.6, 0.35, depth);
    float fade = smoothstep(0.0, 0.25, depth) * smoothstep(1.0, 0.72, depth);
    col += particleLayer(pr + vec2(fi * 0.37, fi * 0.21), z, fi * 17.13 + uSeed, k) * fade * (0.55 + 0.45 * depth);
  }
  // beat shockwave ring
  float ring = exp(-abs(r - 0.08 - uBeat * 0.75) * 30.0) * pow(1.0 - uBeat, 2.0);
  col += uAcc * ring * 0.2 * sat(uPulse * 1.5) * uReact * (0.3 + uEnergy);
  return col;
}
`;
