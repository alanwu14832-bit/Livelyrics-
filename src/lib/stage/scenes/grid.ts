// grid — retro perspective floor grid rushing toward the viewer, striped sun,
// mountain silhouettes and a horizon glow (synthwave).
export const grid = /* glsl */ `
float ridge(float x) {
  return 0.5 * vnoise(vec2(x * 2.3, 1.7)) + 0.3 * vnoise(vec2(x * 5.1, 4.2)) + 0.2 * vnoise(vec2(x * 11.0, 9.1));
}

vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  float k = kick();
  float hz = -0.08;
  float sy = p.y - hz;
  float px = 1.0 / uRes.y;

  // sky
  vec3 col = mix(uBg * 0.9, mix(uBg, uPri, 0.5), exp(-max(sy, 0.0) * 5.0));
  col += uAcc * exp(-max(sy, 0.0) * 18.0) * 0.25;

  // stars
  vec2 sp = fc / uRes.y * 160.0;
  float h = hash12(floor(sp) + uSeed);
  col += vec3(1.0) * smoothstep(0.992, 1.0, h) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5)) * smoothstep(0.05, 0.3, sy) * 0.8;

  // sun with scanline cuts
  vec2 sc = vec2(0.0, hz + 0.25);
  float sunR = 0.2 * (1.0 + 0.03 * k);
  float r = length(p - sc);
  float sun = smoothstep(sunR + px, sunR - px, r);
  float sv = (p.y - sc.y) / sunR;
  float band = fract(sv * 5.0 + uTime * 0.12);
  float gapW = mix(0.0, 0.5, sat((0.3 - sv) / 1.3));
  float aa = 5.0 * px / sunR;
  float stripes = sv < 0.3 ? smoothstep(gapW - aa, gapW + aa, band) : 1.0;
  vec3 sunCol = mix(uAcc, mix(uPri, vec3(1.0), 0.35), sat(sv * 0.5 + 0.5));
  col = mix(col, sunCol, sun * stripes);
  col += sunCol * exp(-max(r - sunR, 0.0) * 9.0) * (0.22 + 0.35 * k) * step(0.0, sy);

  // mountains in front of the sun
  float m = hz + 0.008 + 0.075 * ridge(p.x * 0.8 + 3.0 + uSeed) * (0.6 + 0.4 * smoothstep(0.0, 0.8, abs(p.x)));
  float mountain = smoothstep(m + px, m - px, p.y) * step(hz, p.y);
  vec3 mCol = mix(uBg * 0.6, uPri * 0.35, sat((p.y - hz) * 6.0));
  col = mix(col, mCol, mountain);
  col += uPri * smoothstep(px * 3.0, 0.0, abs(p.y - m)) * mountain * 0.5;

  // floor grid
  if (sy < 0.0) {
    float depth = -sy;
    float z = 0.16 / (depth + 0.0015);
    float dens = mix(1.2, 2.6, uDensity);
    float x = p.x * z * dens;
    float zz = (z + uTime * 1.6) * dens;
    float fx = z * dens * px * 1.5;
    float fz = 0.16 / (depth * depth + 0.0001) * dens * px * 1.5;
    float gx = 0.5 - abs(fract(x) - 0.5);
    float gz = 0.5 - abs(fract(zz) - 0.5);
    float lx = smoothstep(0.02 + fx, 0.0, gx) * (1.0 - smoothstep(0.18, 0.55, fx));
    float lz = smoothstep(0.025 + fz, 0.0, gz) * (1.0 - smoothstep(0.12, 0.45, fz));
    float lines = max(lx, lz);
    float fog = exp(-z * 0.2);
    vec3 floorCol = mix(uBg * 0.5, uBg, fog);
    vec3 lineCol = mix(uPri, uAcc, sat(fog * 1.3));
    col = floorCol + lineCol * lines * fog * (0.75 + 0.9 * k);
    col += mix(uPri, uAcc, 0.6) * exp(-depth * 18.0) * 0.4;
    col += lineCol * lines * exp(-depth * 60.0) * 0.4;
  }
  return col;
}
`;
