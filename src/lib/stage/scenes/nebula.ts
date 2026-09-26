// nebula — flowing, domain-warped clouds of colour with glowing filaments and dust.
export const nebula = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  float t = uTime * 0.07;
  float k = kick();
  float sc = mix(1.1, 2.8, uDensity);

  // far layer: slow, large, dim (parallax depth)
  vec2 qf = p * sc * 0.55 + vec2(t * 0.3, -t * 0.2) + uSeed;
  float far = fbm3(qf + fbm3(qf * 1.3 - t) * 1.2);

  // near layer: two-stage domain warp
  vec2 q = p * sc + uSeed * 1.7;
  vec2 w1 = vec2(fbm3(q + vec2(0.0, t)), fbm3(q + vec2(5.2, 1.3) - t * 0.8));
  vec2 w2 = vec2(fbm3(q + 3.2 * w1 + vec2(1.7, 9.2) + t * 0.45), fbm3(q + 3.2 * w1 + vec2(8.3, 2.8) - t * 0.35));
  float f = fbm(q + 2.4 * w2 + vec2(uBass * 0.25 * uReact, 0.0));

  float r = length(p);
  vec3 col = uBg * (0.65 + 0.45 * (1.0 - r));
  col = mix(col, mix(uBg, uPri, 0.55), smoothstep(0.35, 0.95, far) * 0.7);

  float body = smoothstep(0.28, 0.9, f);
  col = mix(col, uPri * (0.75 + 0.35 * w1.x), body * (0.62 + 0.25 * uEnergy));
  float hot = smoothstep(0.55, 1.05, f * f * 1.25 + length(w2) * 0.22);
  col = mix(col, uAcc, hot * (0.35 + 0.35 * uEnergy + 0.25 * k));

  // bright filaments along the warp ridges
  float fil = pow(sat(1.0 - abs(f - 0.6) * 7.0), 3.0) * smoothstep(0.2, 0.7, w2.y);
  col += mix(uPri, uAcc, 0.6) * fil * (0.22 + 0.5 * k + 0.25 * uEnergy);

  // cosmic dust
  vec2 sp = fc / uRes.y * 220.0;
  vec2 cell = floor(sp);
  float h = hash12(cell + uSeed);
  float star = smoothstep(0.985, 1.0, h) * smoothstep(0.55, 0.0, length(fract(sp) - 0.5));
  star *= 0.55 + 0.45 * sin(uClock * (1.0 + h * 3.0) + h * 40.0);
  col += vec3(0.9, 0.92, 1.0) * star * (0.5 + 0.5 * (1.0 - body));

  // soft breathing core glow
  col += uPri * exp(-r * 3.2) * (0.08 + 0.18 * k);
  return col;
}
`;
