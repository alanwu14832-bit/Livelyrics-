// motif — the key-visual emblem: a glowing central mark breathing with the beat,
// a slow orbit of smaller copies, radial light rays and a faint tiled wallpaper.
export const motif = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  float k = kick();
  float r = length(p);
  float a = atan(p.y, p.x);

  vec3 col = mix(mix(uBg, uPri, 0.16), uBg * 0.55, sat(r * 1.25));

  // rays
  float rays = pow(0.5 + 0.5 * sin(a * floor(mix(7.0, 16.0, uDensity)) + uTime * 0.18), 5.0);
  col += mix(uPri, uAcc, 0.3) * rays * exp(-r * 2.4) * (0.12 + 0.2 * k);

  // wallpaper of small motifs
  vec2 tp = rot(0.32) * p * mix(3.2, 6.0, uDensity) + vec2(uTime * 0.04, uTime * 0.015);
  vec2 tid = floor(tp);
  float checker = mod(tid.x + tid.y, 2.0);
  float tm = motifMask((fract(tp) - 0.5) * 1.35 + 0.5, 0.4);
  col += mix(uPri, uAcc, checker * 0.6) * tm * (0.05 + 0.03 * checker) * smoothstep(0.12, 0.6, r);

  // orbit
  float n = floor(mix(5.0, 9.0, uDensity));
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float ang = fi / n * TAU + uTime * 0.12;
    vec2 c = vec2(cos(ang), sin(ang)) * vec2(0.4, 0.33);
    float s = 0.055 * (1.0 + 0.12 * k * step(0.5, hash11(fi + floor(uBeatN))));
    vec2 muv = rot(-ang) * (p - c) / (2.0 * s) + 0.5;
    float m = motifMask(muv, 0.0);
    float g = motifMask(muv, 3.0);
    col = mix(col, mix(uPri, uAcc, 0.5 + 0.5 * sin(fi)), m * 0.75);
    col += uAcc * g * 0.12;
  }

  // central emblem
  float s = 0.23 * (1.0 + 0.07 * k + 0.02 * sin(uTime * 0.5));
  vec2 muv = rot(sin(uTime * 0.13) * 0.12) * p / (2.0 * s) + 0.5;
  float core = motifMask(muv, 0.0);
  float glow = motifMask(muv, 3.5);
  float glowWide = motifMask((muv - 0.5) * 0.72 + 0.5, 5.5);
  col += uAcc * (glow * 0.55 + glowWide * 0.45) * (0.45 + 0.9 * k + 0.25 * uEnergy);
  vec3 coreCol = mix(mix(uPri, vec3(1.0), 0.42), mix(uAcc, vec3(1.0), 0.2), smoothstep(0.15, 0.95, muv.y) * 0.55);
  col = mix(col, coreCol * (1.0 + 0.25 * k), core);
  return col;
}
`;
