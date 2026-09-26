// blackout — intentional darkness. The renderer short-circuits this scene to a
// pure black clear; the shader exists so every SceneId has a program.
export const blackout = /* glsl */ `
vec3 scene(vec2 fc) {
  return vec3(0.0) * fc.x;
}
`;
