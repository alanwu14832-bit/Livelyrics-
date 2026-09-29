// rain — vertical light streaks falling through layered depth, soft mist below.
export const rain = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = centered(fc);
  float k = kick();
  vec3 col = mix(uBg * 0.55, mix(uBg, uPri, 0.22), smoothstep(0.0, 1.0, uv.y));
  col += uPri * smoothstep(0.55, 1.0, fbm3(p * 1.6 + vec2(0.0, uTime * 0.05) + uSeed)) * 0.08;

  for (int i = 0; i < 3; i++) {
    float fl = float(i);
    float near = 1.0 - fl * 0.33;
    float cols = mix(26.0, 70.0, uDensity) * (1.0 + fl * 0.9);
    vec2 q = p;
    q.x += fl * 0.137 + q.y * 0.06;
    float cx = floor(q.x * cols);
    float fx = fract(q.x * cols) - 0.5;
    float h = hash11(cx * 1.13 + fl * 71.0 + uSeed);
    float lit = step(0.55 - uDensity * 0.3, hash11(cx * 2.71 + fl * 13.0));
    float speed = (0.55 + h * 0.9) * (1.25 - fl * 0.3);
    float period = 1.4 + hash11(cx * 5.3) * 1.6;
    float y = (q.y + uTime * speed * 0.75 + h * 9.0) / period;
    float fy = fract(y);
    float cycle = floor(y);
    float len = 0.18 + 0.32 * hash11(cx * 3.7 + cycle);
    float streak = smoothstep(len, 0.0, fy) * smoothstep(0.0, 0.015, fy);
    streak *= step(0.3, hash11(cycle * 7.1 + cx));
    float w = mix(0.05, 0.12, near) * (1.0 + 0.6 * k * near);
    float line = smoothstep(w, 0.0, abs(fx));
    float glow = smoothstep(0.5, 0.0, abs(fx)) * 0.12;
    vec3 c = mix(uPri, mix(uAcc, vec3(1.0), 0.3), smoothstep(len * 0.25, 0.0, fy));
    col += c * streak * (line + glow) * lit * near * (0.6 + 0.6 * uEnergy + 0.6 * k * near);
  }
  // mist and splash glow near the floor
  col += mix(uPri, uAcc, 0.3) * exp(-uv.y * 7.0) * (0.12 + 0.2 * k);
  return col;
}
`;
