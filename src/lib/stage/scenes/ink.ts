// ink — high-contrast, domain-warped ink flowing through water, with
// accent-coloured veins where the ink meets the ground.
export const ink = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 p = centered(fc) * mix(1.1, 2.4, uDensity);
  float k = kick();
  float t = uTime * 0.09;
  vec2 w = vec2(fbm3(p * 1.25 + vec2(t, -t * 0.6) + uSeed), fbm3(p * 1.25 + vec2(4.7, 1.9) - t * 0.8));
  w = rot(t * 0.7) * (w - 0.5) * 2.0;
  vec2 w2 = vec2(fbm3(p * 2.0 + 1.8 * w + 7.3), fbm3(p * 2.0 + 1.8 * w + 2.1));
  float f = fbm(p * 1.4 + 1.6 * w + 1.2 * w2 + vec2(t * 0.5, -t * 0.3));
  f += (uBass * 0.06 + k * 0.03) * uReact;

  float th = 0.55 + 0.035 * sin(uTime * 0.21);
  float inkA = smoothstep(th - 0.012, th + 0.012, f);
  float inkB = smoothstep(th + 0.11, th + 0.125, f);
  float vein = 1.0 - smoothstep(0.0, 0.018, abs(f - th));
  float vein2 = 1.0 - smoothstep(0.0, 0.012, abs(f - th - 0.118));

  // paper / water ground with faint fibres
  float fibre = fbm3(p * vec2(9.0, 2.0) + 3.0);
  vec3 ground = uBg * (0.85 + 0.25 * fibre) + uPri * 0.06 * smoothstep(0.3, 0.55, f);
  vec3 inkCol = mix(uPri * 0.45, uPri * (0.95 + 0.25 * w2.x), smoothstep(th, th + 0.22, f));
  vec3 deep = mix(uPri, uAcc, 0.35) * 1.05;

  vec3 col = mix(ground, inkCol, inkA);
  col = mix(col, deep, inkB * 0.85);
  col += uAcc * vein * (0.55 + 0.9 * k) + mix(uAcc, vec3(1.0), 0.4) * vein2 * 0.35;
  col += uAcc * exp(-abs(f - th) * 30.0) * 0.08 * (1.0 + uEnergy);
  return col;
}
`;
