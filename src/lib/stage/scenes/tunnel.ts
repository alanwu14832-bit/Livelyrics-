// tunnel — a tunnel of light panels rushing toward the viewer, slowly twisting,
// with a bright opening at the far end; panels flare on the beat.
export const tunnel = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  float k = kick();
  float px = 1.0 / uRes.y;
  p += 0.05 * vec2(sin(uTime * 0.31), cos(uTime * 0.23));
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x);

  float z = 0.35 / r + uTime * 1.2;
  float seg = floor(mix(8.0, 20.0, uDensity));
  float along = mix(1.6, 3.2, uDensity);
  float u = (a + z * 0.08) / TAU * seg;
  float v = z * along;
  vec2 cell = floor(vec2(u, v));
  vec2 f = fract(vec2(u, v));
  vec2 d = min(f, 1.0 - f);
  // pixel footprint in panel units, for anti-aliasing and moire suppression
  float fu = seg / (TAU * r) * px;
  float fv = 0.35 / (r * r) * along * px;
  float eu = smoothstep(0.05 + fu * 1.5, 0.0, d.x) * (1.0 - smoothstep(0.25, 0.7, fu));
  float ev = smoothstep(0.06 + fv * 1.5, 0.0, d.y) * (1.0 - smoothstep(0.2, 0.6, fv));
  float edges = max(eu * 0.5, ev);

  float h = hash12(cell);
  float lit = step(0.72, h) * (0.55 + 0.45 * sin(uClock * 1.7 + h * 30.0));
  float flare = step(0.88, hash12(cell + floor(uBeatN) * 1.37)) * k;
  float tex = vnoise(vec2(u, v) * 2.0) * (1.0 - smoothstep(0.3, 1.0, fv));

  float fog = smoothstep(0.0, 0.45, r);
  vec3 ringCol = mix(uPri, uAcc, step(0.72, hash11(cell.y * 1.7)));
  vec3 col = uBg * (0.35 + 0.65 * fog);
  col += mix(uBg, uPri, 0.5) * (0.1 + 0.16 * tex) * fog;
  col += mix(uPri, uAcc, h) * (lit * 0.35 + flare * 0.9) * fog * (1.0 - edges);
  col += ringCol * edges * fog * (0.55 + 0.9 * k);

  vec3 lightCol = mix(uAcc, vec3(1.0), 0.4);
  col += lightCol * exp(-r * 10.0) * (0.45 + 0.9 * k);
  col += lightCol * exp(-r * 3.0) * 0.08 * (1.0 + uEnergy);
  return col;
}
`;
