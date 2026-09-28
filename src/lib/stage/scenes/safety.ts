// LED 安全模式 (phase 3) passes of the GL compositor. With safe mode on, the scene (with its section
// transition) and the band media render into an offscreen target S instead of the screen, then:
//
//   downsample   S → a (cols·8 × rows·8) intermediate (9 bilinear taps per texel, soften applied
//                per tap) → the (cols × rows) luminance grid (8 × 8 exact taps), read back by the
//                CPU for the flash limiter (src/lib/stage/safety.ts)
//   low-pass     F = mix(F_prev, soften(S) × gain, α) (gain = the brightness cap), ping-pong between
//                two targets; α = 1 passes through; 8-bit feedback always moves at least one code
//                value so it converges; a static dither against banding under the cap
//   present      F to the screen: blitFramebuffer on WebGL2, a copy shader on WebGL1
//
// `softenC` must stay identical to softenChannel() in safety.ts (the limiter's model and the lyric
// colours use the TS version).

const SOFTEN_GLSL = /* glsl */ `
vec3 softenC(vec3 x, float s) {
  x = clamp(x, 0.0, 1.0);
  if (s <= 0.0) return x;
  float k = 1.0 - 0.55 * s;
  float top = 1.0 - 0.25 * s;
  float span = top - k;
  vec3 over = max(x - k, 0.0);
  vec3 rolled = k + span * (1.0 - exp(-over / span));
  return mix(x, rolled, step(vec3(k), x));
}
`;

export const SAFETY_LOWPASS_UNIFORMS = ["uRes", "uSrc", "uPrev", "uAlpha", "uSoften", "uFirst", "uGain"] as const;

/**
 * F = mix(F_prev, soften(S) × gain, α). F is kept after the cap (with a static dither against
 * banding when the cap is below 1), so presenting it is a plain copy (blitFramebuffer on WebGL2).
 */
export const SAFETY_LOWPASS_FRAGMENT = /* glsl */ `
uniform vec2 uRes;
uniform sampler2D uSrc;
uniform sampler2D uPrev;
uniform float uAlpha;
uniform float uSoften;
uniform float uFirst;
uniform float uGain;
${SOFTEN_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 src = softenC(TEX(uSrc, uv).rgb, uSoften) * uGain;
  float l = dot(src, vec3(0.2126, 0.7152, 0.0722));
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  src = clamp(src + (ign - 0.5) * (1.0 / 255.0) * step(0.003, l) * step(uGain, 0.999), 0.0, 1.0);
  if (uFirst > 0.5 || uAlpha >= 0.9999) {
    FRAG = vec4(src, 1.0);
    return;
  }
  vec3 prev = TEX(uPrev, uv).rgb;
  vec3 d = src - prev;
  vec3 stepv = d * clamp(uAlpha, 0.0, 1.0);
  vec3 minStep = min(abs(d), vec3(1.0 / 255.0));
  stepv = sign(d) * max(abs(stepv), minStep);
  FRAG = vec4(clamp(prev + stepv, 0.0, 1.0), 1.0);
}
`;

export const SAFETY_PRESENT_UNIFORMS = ["uRes", "uTex"] as const;

/** WebGL1 only (WebGL2 blits): F to the screen. */
export const SAFETY_PRESENT_FRAGMENT = /* glsl */ `
uniform vec2 uRes;
uniform sampler2D uTex;
void main() {
  FRAG = vec4(TEX(uTex, gl_FragCoord.xy / uRes).rgb, 1.0);
}
`;

export const SAFETY_DOWN1_UNIFORMS = ["uSrc", "uSrcRes", "uDst", "uSoften"] as const;

/** S → intermediate: each output texel averages 3 × 3 bilinear taps (each a 2 × 2 texel mean). */
export const SAFETY_DOWN1_FRAGMENT = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uSrcRes;
uniform vec2 uDst;
uniform float uSoften;
${SOFTEN_GLSL}
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 uv = (cell + (vec2(float(i), float(j)) + 0.5) / 3.0) / uDst;
      acc += softenC(TEX(uSrc, uv).rgb, uSoften);
    }
  }
  FRAG = vec4(acc / 9.0, 1.0);
}
`;

export const SAFETY_DOWN2_UNIFORMS = ["uSrc", "uSrcRes", "uDst"] as const;

/** intermediate → grid: the exact mean of each 8 × 8 block (texel centres). */
export const SAFETY_DOWN2_FRAGMENT = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uSrcRes;
uniform vec2 uDst;
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      vec2 px = cell * 8.0 + vec2(float(i), float(j)) + 0.5;
      acc += TEX(uSrc, px / uSrcRes).rgb;
    }
  }
  FRAG = vec4(acc / 64.0, 1.0);
}
`;

/** Intermediate texels per grid cell (each side). */
export const DOWNSAMPLE_FACTOR = 8;
