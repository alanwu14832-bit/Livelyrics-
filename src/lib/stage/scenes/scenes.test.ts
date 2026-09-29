import { describe, expect, it } from "vitest";
import { SCENE_IDS } from "../../schema";
import { COMPOSITE_FRAGMENT, SCENE_LABELS, SCENE_SHADERS, buildSceneFragment } from "./index";

// Functions / syntax that exist in GLSL ES 3.00 but not in 1.00 (WebGL1 fallback).
const ES3_ONLY = [/\bround\s*\(/, /\btanh\s*\(/, /\bsinh\s*\(/, /\bcosh\s*\(/, /\btexelFetch\b/, /\btextureLod\b/, /\binverse\s*\(/, /\btranspose\s*\(/, /\buint\b/, /\[\s*\]/, /[^/]%[^=]/];

// Reserved for future use in GLSL ES; using them as identifiers fails to compile.
const RESERVED = [
  "active", "asm", "cast", "class", "common", "enum", "extern", "external", "filter", "fixed", "goto", "half",
  "hvec2", "hvec3", "hvec4", "inline", "input", "interface", "long", "namespace", "noinline", "output", "partition",
  "public", "resource", "sample", "short", "sizeof", "static", "superp", "template", "this", "typedef", "union",
  "unsigned", "using", "volatile", "patch", "subroutine",
];

describe("scene shaders", () => {
  it("does not use reserved words as identifiers", () => {
    const sources = [...SCENE_IDS.map((id) => [id, SCENE_SHADERS[id]] as const), ["composite", COMPOSITE_FRAGMENT] as const];
    for (const [id, src] of sources) {
      const code = src.replace(/\/\/[^\n]*/g, "");
      for (const word of RESERVED) expect(new RegExp(`\\b${word}\\b`).test(code), `${id} uses reserved word "${word}"`).toBe(false);
    }
  });

  it("implements every SceneId", () => {
    for (const id of SCENE_IDS) {
      expect(SCENE_SHADERS[id], id).toMatch(/vec3 scene\(vec2 fc\)/);
      expect(SCENE_LABELS[id], id).toBeTruthy();
    }
  });

  it("stays inside the GLSL ES 1.00 subset", () => {
    for (const id of SCENE_IDS) {
      const src = SCENE_SHADERS[id];
      for (const re of ES3_ONLY) expect(re.test(src), `${id} uses ${re}`).toBe(false);
    }
    for (const re of ES3_ONLY) expect(re.test(COMPOSITE_FRAGMENT), `composite uses ${re}`).toBe(false);
  });

  it("has balanced braces and parentheses", () => {
    for (const id of SCENE_IDS) {
      const src = buildSceneFragment(SCENE_SHADERS[id], true);
      const count = (ch: string) => src.split(ch).length - 1;
      expect(count("{"), id).toBe(count("}"));
      expect(count("("), id).toBe(count(")"));
    }
  });

  it("uses the right header per GL version", () => {
    expect(buildSceneFragment(SCENE_SHADERS.nebula, true).startsWith("#version 300 es")).toBe(true);
    expect(buildSceneFragment(SCENE_SHADERS.nebula, false)).toContain("gl_FragColor");
  });
});
