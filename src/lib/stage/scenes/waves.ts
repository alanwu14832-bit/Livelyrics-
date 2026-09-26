// waves — layered luminous ribbons, like a slow oscilloscope drawn in light.
export const waves = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = centered(fc);
  float k = kick();
  vec3 col = mix(uBg * 0.6, mix(uBg, uPri, 0.18), smoothstep(0.0, 1.0, uv.y));
  col += uPri * exp(-p.y * p.y * 9.0) * 0.08;

  float n = floor(mix(6.0, 18.0, uDensity));
  float px = 1.0 / uRes.y;
  float envX = exp(-p.x * p.x * 0.9);
  for (int i = 0; i < 20; i++) {
    float fi = float(i);
    if (fi >= n) break;
    float kf = fi / max(n - 1.0, 1.0);
    float amp = (0.05 + 0.13 * uEnergy + 0.07 * k) * (0.55 + 0.65 * sin(kf * PI)) * (0.35 + 0.65 * envX);
    float y = amp * sin(p.x * (2.2 + kf * 1.7) + uTime * (0.55 + kf * 0.45) + fi * 1.3)
            + amp * 0.45 * sin(p.x * (5.1 - kf * 2.3) - uTime * (0.85 + kf * 0.3) + fi * 0.7)
            + amp * 0.2 * sin(p.x * 11.0 + uTime * 1.7 + fi) * uBass * uReact
            + (kf - 0.5) * 0.5;
    float d = abs(p.y - y);
    float w = mix(1.2, 2.6, hash11(fi * 7.3)) * px * (1.0 + k * 1.2);
    float core = smoothstep(w + px, w - px * 0.5, d);
    float glow = w * 2.5 / (d + w * 2.5) * 0.12;
    float ribbon = smoothstep(0.07, 0.0, abs(p.y - y + 0.035)) * 0.05;
    vec3 c = mix(uPri, uAcc, smoothstep(0.2, 0.9, kf + 0.15 * sin(uTime * 0.2 + fi)));
    float edge = smoothstep(0.95, 0.55, abs(p.x) / (uRes.x / uRes.y));
    col += c * (core * 0.9 + glow + ribbon) * edge * (0.55 + 0.45 * uIntensity);
  }
  return col;
}
`;
