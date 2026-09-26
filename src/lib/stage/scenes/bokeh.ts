// bokeh — soft, out-of-focus light orbs floating in layers of depth.
export const bokeh = /* glsl */ `
vec3 bokehLayer(vec2 p, float fl, float k) {
  float scale = mix(1.8, 4.6, fl / 3.0) * mix(0.85, 1.3, uDensity);
  vec2 q = p * scale + vec2(uTime * 0.06 * (1.0 + fl * 0.3), -uTime * 0.09 * (1.0 + fl * 0.25)) + fl * 7.31 + uSeed;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  vec2 h = hash22(id + fl * 31.7);
  float present = step(0.5 - uDensity * 0.35, hash12(id * 1.9 + fl));
  float rad = mix(0.17, 0.33, hash12(id * 1.3 + fl)) * (1.0 + 0.1 * k);
  vec2 o = (h - 0.5) * 2.0 * (0.48 - rad);
  float d = length(f - o);
  float soft = 0.01 + fl * 0.035;
  float disk = smoothstep(rad, rad - soft, d);
  float rim = smoothstep(rad - 0.045, rad - soft * 0.5, d) * disk;
  float body = disk * (0.72 + 0.28 * (1.0 - d / rad)) + rim * 0.3;
  float tw = 0.7 + 0.3 * sin(uTime * 0.6 + h.y * 20.0);
  vec3 c = mix(uPri, uAcc, smoothstep(0.35, 0.85, h.y));
  c = mix(c, vec3(1.0), 0.1 + 0.15 * rim);
  return c * body * present * tw;
}

vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  float k = kick();
  float r = length(p);
  vec3 col = mix(mix(uBg, uPri, 0.14), uBg * 0.6, sat(r * 1.2));
  // atmospheric haze behind the orbs
  col += uPri * 0.1 * exp(-dot(p - vec2(-0.5, 0.25), p - vec2(-0.5, 0.25)) * 3.0);
  col += uAcc * 0.07 * exp(-dot(p - vec2(0.55, -0.3), p - vec2(0.55, -0.3)) * 3.0);
  for (int i = 0; i < 4; i++) {
    float fl = float(i);
    float alpha = mix(0.5, 0.2, fl / 3.0) * (0.75 + 0.45 * uEnergy);
    col += bokehLayer(p, fl, k) * alpha;
  }
  col += uAcc * exp(-r * r * 6.0) * 0.05 * (1.0 + k);
  return col;
}
`;
