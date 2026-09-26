// shards — slowly turning stained glass: voronoi cells with dark leading, glass
// texture, a travelling light sweep and cells that flare on the beat.
export const shards = /* glsl */ `
vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  float k = kick();
  vec2 q = rot(uTime * 0.018) * p * mix(3.2, 8.0, uDensity) + uSeed;
  vec2 ip = floor(q);
  vec2 fp = fract(q);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 cell = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 h = hash22(ip + g);
      vec2 o = 0.5 + 0.38 * sin(uTime * 0.25 + h * TAU);
      vec2 rr = g + o - fp;
      float d = dot(rr, rr);
      if (d < d1) { d2 = d1; d1 = d; cell = ip + g; }
      else if (d < d2) { d2 = d; }
    }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float h = hash12(cell);
  float h2 = hash12(cell + 19.19);

  vec3 glass = mix(mix(uBg, uPri, 0.3), uPri, smoothstep(0.25, 0.85, h));
  glass = mix(glass, uAcc, smoothstep(0.84, 0.97, h));
  glass *= 0.55 + 0.5 * fbm3(q * 1.7 + h * 10.0);

  // light sweeping across the window
  float sweepPos = fract(uTime * 0.035 + h2 * 0.08);
  float sweep = exp(-pow((dot(p, normalize(vec2(1.0, 0.45))) * 0.6 + 0.5 - sweepPos) * 5.0, 2.0));
  glass *= 0.26 + 1.0 * sweep + 0.22 * uEnergy + 0.25 * exp(-dot(p, p) * 3.0);

  // per-beat flares on random cells
  float flare = step(0.86, hash12(cell + floor(uBeatN) * 3.17)) * kick() * 1.4;
  glass += mix(uAcc, vec3(1.0), 0.3) * flare;

  float lead = smoothstep(0.02, 0.09, edge);
  float bevel = smoothstep(0.09, 0.2, edge);
  vec3 col = uBg * 0.25;
  col = mix(col, glass * (0.75 + 0.25 * bevel), lead);
  col += mix(uPri, uAcc, 0.5) * smoothstep(0.035, 0.0, abs(edge - 0.1)) * 0.18 * (0.5 + k);
  col *= 0.8 + 0.35 * exp(-dot(p, p) * 2.0);
  return col;
}
`;
