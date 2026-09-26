// gradient — calm, minimal colour field. Slow luminous blobs drift at the edges
// while the centre stays quiet so the lyrics can lead.
export const gradient = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  float t = uTime * 0.06;
  float spread = mix(2.2, 4.8, uDensity);
  vec2 warp = vec2(fbm3(p * 1.2 + t + uSeed), fbm3(p * 1.2 - t + 3.3)) - 0.5;
  vec2 q = p + warp * 0.18;
  vec2 c1 = vec2(-0.55 + 0.14 * sin(t * 1.3), 0.3 + 0.08 * cos(t * 1.1));
  vec2 c2 = vec2(0.58 + 0.12 * cos(t * 0.9), -0.24 + 0.12 * sin(t * 1.7));
  vec2 c3 = vec2(0.12 * sin(t * 0.7), -0.62 + 0.08 * cos(t));
  float g1 = exp(-dot(q - c1, q - c1) * spread);
  float g2 = exp(-dot(q - c2, q - c2) * spread);
  float g3 = exp(-dot(q - c3, q - c3) * spread * 1.4);

  vec3 col = uBg;
  col = mix(col, uPri, g1 * 0.62);
  col = mix(col, uAcc, g2 * 0.42);
  col = mix(col, mix(uPri, uAcc, 0.5), g3 * 0.3);
  // quiet centre band for lyrics
  col = mix(col, uBg, 0.3 * exp(-p.y * p.y * 7.0) * exp(-p.x * p.x * 1.5));
  col *= 0.92 + 0.1 * uEnergy + 0.05 * kick();
  return col;
}
`;
