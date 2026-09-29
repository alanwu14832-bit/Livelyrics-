import { describe, expect, it } from "vitest";
import { buildProgramFragment, PROGRAM_CONTRACT_DOC, PROGRAM_PRELUDE, PROGRAM_UNIFORMS, RELATION_CODE, SECTION_KIND_CODE } from "./contract";
import { EXAMPLE_PROGRAMS, instantiateExample } from "./examples";
import { activeProgram, canvasZone, keyMomentOf, normalizeSceneProgram, normalizeZone, programSection, sectionComposition } from "./model";
import { programFrame } from "./runtime";
import { MAX_LOOP_ITERATIONS, stripComments, validateProgram } from "./validate";
import { createDemoProject } from "../demo";
import { resolveLook } from "../resolve";
import { initialStageState } from "../protocol";

const OK_BODY = `
float wave(vec2 p) { return sin(p.x * 8.0 + uTime) * 0.5 + 0.5; }
vec3 scene(vec2 fc) {
  vec2 uv = fc / uRes;
  float v = 0.0;
  for (int i = 0; i < 4; i++) { v += wave(uv * float(i + 1)) * 0.25; }
  gFront = step(0.5, uv.x);
  return mix(uBg, uPri, v) + uAcc * typeGlow(uv, 0.01) * 0.2;
}`;

const bad = (src: string) => {
  const r = validateProgram(src);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors.join("\n");
};

describe("scene program validator", () => {
  it("accepts a well-formed program and strips comments (non-ASCII allowed only in comments)", () => {
    const r = validateProgram(`// 夜航：註解可以寫中文\n${OK_BODY}\n/* 區塊註解 */`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code).not.toMatch(/夜航|區塊/);
      expect(r.code).toContain("vec3 scene(vec2 fc)");
    }
  });

  it("refuses preprocessor directives, extensions and version lines", () => {
    expect(bad(`#extension GL_OES_standard_derivatives : enable\n${OK_BODY}`)).toMatch(/前處理/);
    expect(bad(`#define X 1.0\n${OK_BODY}`)).toMatch(/前處理/);
    expect(bad(`#version 300 es\n${OK_BODY}`)).toMatch(/前處理/);
  });

  it("refuses interface declarations, raw texture lookups and main()", () => {
    expect(bad(`uniform float uEvil;\n${OK_BODY}`)).toMatch(/uniform/);
    expect(bad(`${OK_BODY}\nvec4 peek() { return texture2D(uType, vec2(0.5)); }`)).toMatch(/取樣/);
    expect(bad(`${OK_BODY}\nvec4 peek() { return texture(uType, vec2(0.5)); }`)).toMatch(/取樣/);
    expect(bad(`${OK_BODY}\nvoid main() {}`)).toMatch(/main/);
    expect(bad(`${OK_BODY}\nfloat f() { return gl_FragCoord.x; }`)).toMatch(/gl_/);
    expect(bad(`sampler2D s;\n${OK_BODY}`)).toMatch(/取樣器/);
    expect(bad(`precision highp float;\n${OK_BODY}`)).toMatch(/精度/);
    expect(bad(`out vec4 o;\n${OK_BODY}`)).toMatch(/in／out/);
  });

  it("allows in / out qualifiers on function parameters", () => {
    expect(validateProgram(`void two(in float a, out float b) { b = a * 2.0; }\n${OK_BODY}`).ok).toBe(true);
  });

  it("refuses unbounded and oversized loops", () => {
    expect(bad(OK_BODY.replace("for (int i = 0; i < 4; i++) { v += wave(uv * float(i + 1)) * 0.25; }", "while (v < 1.0) { v += 0.1; }"))).toMatch(/while/);
    expect(bad(OK_BODY.replace("i < 4", "i < 400"))).toMatch(new RegExp(`上限 ${MAX_LOOP_ITERATIONS}`));
    expect(bad(OK_BODY.replace("i < 4", "i < int(uTime)"))).toMatch(/常數/);
    expect(bad(OK_BODY.replace("i++", "i--"))).toMatch(/無限/);
    const nested = OK_BODY.replace("for (int i = 0; i < 4; i++) {", "for (int j = 0; j < 40; j++) { for (int i = 0; i < 40; i++) {").replace("* 0.25; }", "* 0.25; } }");
    expect(bad(nested)).toMatch(/巢狀/);
    expect(bad(OK_BODY.replace("i < 4; i++", "i < 4; i += 0"))).toMatch(/步長/);
  });

  it("keeps the WebGL1 subset: no ES 3.00-only builtins, uint, bit operations or %", () => {
    expect(bad(`${OK_BODY}\nfloat r(float x) { return round(x); }`)).toMatch(/round/);
    expect(bad(`${OK_BODY}\nfloat r(float x) { return tanh(x); }`)).toMatch(/tanh/);
    expect(bad(`${OK_BODY}\nint r(int x) { return x % 2; }`)).toMatch(/%/);
    expect(bad(`${OK_BODY}\nint r(int x) { return x & 1; }`)).toMatch(/位元/);
    expect(bad(`${OK_BODY}\nuint r() { return 1u; }`)).toMatch(/uint|無號/);
    expect(bad(`${OK_BODY}\nfloat r(float x) { return dFdx(x); }`)).toMatch(/導數/);
  });

  it("requires exactly one vec3 scene(vec2) and forbids redefining the prelude", () => {
    expect(bad("vec3 other(vec2 fc) { return vec3(0.0); }")).toMatch(/缺少/);
    expect(bad("vec4 scene(vec2 fc) { return vec4(0.0); }")).toMatch(/vec3 scene/);
    expect(bad(`${OK_BODY}\nvec3 scene(vec2 q) { return vec3(1.0); }`)).toMatch(/不只一次/);
    expect(bad(`float hash12(vec2 p) { return 0.0; }\n${OK_BODY}`)).toMatch(/hash12/);
    expect(bad(`float uTime = 1.0;\n${OK_BODY}`)).toMatch(/uTime/);
  });

  it("refuses non-ASCII code, unbalanced braces and oversized sources", () => {
    expect(bad(OK_BODY.replace("float v", "float 值"))).toMatch(/ASCII/);
    expect(bad(OK_BODY.slice(0, -1))).toMatch(/大括號/);
    expect(bad(`${OK_BODY}\n${"// x\n".repeat(10)}${"float pad0 = 1.0;\n".repeat(1200)}`)).toMatch(/太長/);
    expect(bad("")).toMatch(/沒有程式碼/);
  });

  it("strips comments without joining lines", () => {
    expect(stripComments("a // b\nc /* d\ne */ f").split("\n")).toHaveLength(3);
  });
});

describe("uniform contract and prelude", () => {
  it("declares every contract uniform exactly once and documents it for Claude", () => {
    for (const u of PROGRAM_UNIFORMS) {
      const decl = new RegExp(`uniform\\s+\\w+\\s+${u};`, "g");
      expect(PROGRAM_PRELUDE.match(decl)?.length ?? 0, u).toBe(1);
      expect(PROGRAM_CONTRACT_DOC, u).toContain(u);
    }
    expect(Object.keys(SECTION_KIND_CODE)).toHaveLength(9);
    expect(RELATION_CODE).toEqual({ plain: 0, knockout: 1, behind: 2, lit: 3 });
  });

  it("wraps the body: header first, the prelude, the body after #line 1, main() last; alpha carries 1 − gFront", () => {
    const gl2 = buildProgramFragment("vec3 scene(vec2 fc) { return uBg; }", true);
    expect(gl2.startsWith("#version 300 es")).toBe(true);
    expect(gl2.indexOf("uniform vec2 uRes;")).toBeLessThan(gl2.indexOf("#line 1"));
    expect(gl2.indexOf("#line 1")).toBeLessThan(gl2.indexOf("vec3 scene(vec2 fc)"));
    expect(gl2.trim().endsWith("}")).toBe(true);
    expect(gl2).toMatch(/1\.0 - clamp\(gFront, 0\.0, 1\.0\)/);
    const gl1 = buildProgramFragment("vec3 scene(vec2 fc) { return uBg; }", false);
    expect(gl1).toContain("gl_FragColor");
    expect(gl1).not.toContain("#version");
  });
});

describe("example programs", () => {
  it("every example passes the validator and covers the main kinds", () => {
    for (const ex of EXAMPLE_PROGRAMS) {
      const r = validateProgram(ex.source);
      expect(r.ok ? [] : r.errors, ex.id).toEqual([]);
      expect(ex.byKind.verse && ex.byKind.chorus, ex.id).toBeTruthy();
    }
    expect(EXAMPLE_PROGRAMS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(EXAMPLE_PROGRAMS.map((e) => e.id)).size).toBe(EXAMPLE_PROGRAMS.length);
  });

  it("instantiates onto a plan: one state per section, by kind", () => {
    const demo = createDemoProject();
    const prog = instantiateExample(EXAMPLE_PROGRAMS[0], demo.plan!);
    expect(prog.sections.map((s) => s.sectionId)).toEqual(demo.plan!.sections.map((s) => s.id));
    const n = normalizeSceneProgram(prog, { sections: demo.plan!.sections });
    expect(n?.sections).toHaveLength(demo.plan!.sections.length);
  });
});

describe("program normalization and composition", () => {
  const demo = createDemoProject();
  const sections = demo.plan!.sections;

  it("drops a program that fails the validator (the plan keeps its built-in scenes)", () => {
    const repairs: string[] = [];
    expect(normalizeSceneProgram({ source: "#extension X : enable\nvec3 scene(vec2 fc){return vec3(0.0);}", sections: [] }, { sections, repairs })).toBeNull();
    expect(repairs.join()).toMatch(/內建場景/);
    expect(normalizeSceneProgram(null)).toBeNull();
  });

  it("clamps values, fills missing sections by kind, keeps the switch", () => {
    const repairs: string[] = [];
    const n = normalizeSceneProgram(
      { engine: "claude", title: "x", concept: "y", source: OK_BODY, enabled: false, sections: [{ sectionId: sections[0].id, mode: 9, params: [2, -1, 0.5], zone: { x: -1, y: 0.9, w: 0.05, h: 3 }, relation: "nope", note: 3 }] },
      { sections, repairs },
    )!;
    expect(n.enabled).toBe(false);
    expect(n.sections[0].mode).toBe(3);
    expect(n.sections[0].params).toEqual([1, 0, 0.5, KIND_DEFAULTS_OF(sections[0].kind)[3]]);
    expect(n.sections[0].relation).toBe("plain");
    const z = n.sections[0].zone;
    expect(z.x).toBeGreaterThanOrEqual(0.04);
    expect(z.w).toBeGreaterThanOrEqual(0.3);
    expect(z.y + z.h).toBeLessThanOrEqual(0.94 + 1e-9);
    expect(n.sections).toHaveLength(sections.length);
    const chorus = sections.findIndex((s) => s.kind === "chorus");
    expect(n.sections[chorus].mode).toBe(2);
    expect(repairs.join()).toMatch(/補上/);
    expect(activeProgram({ ...demo.plan!, sceneProgram: n })).toBeNull();
    expect(activeProgram({ ...demo.plan!, sceneProgram: { ...n, enabled: true } })).not.toBeNull();
  });

  it("programSection falls back by kind for a section the program does not know (a re-designed plan)", () => {
    const prog = instantiateExample(EXAMPLE_PROGRAMS[0], demo.plan!);
    const s = programSection({ ...prog, sections: [] }, { id: "s99", kind: "chorus" }, 99);
    expect(s.mode).toBe(2);
  });

  it("zones: clamped to the canvas; a side zone becomes a band on a tall canvas, alternating top and bottom", () => {
    const z = normalizeZone({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
    expect(z.x + z.w).toBeLessThanOrEqual(0.96 + 1e-9);
    expect(z.y + z.h).toBeLessThanOrEqual(0.94 + 1e-9);
    const left = canvasZone({ x: 0.08, y: 0.1, w: 0.4, h: 0.6 }, 9 / 16);
    const right = canvasZone({ x: 0.52, y: 0.1, w: 0.4, h: 0.6 }, 9 / 16);
    expect(left.w).toBeGreaterThan(0.8);
    expect(left.y).toBeLessThan(0.3);
    expect(right.y).toBeGreaterThanOrEqual(0.5);
    expect(canvasZone(left, 16 / 9)).toEqual(left);
  });

  it("the type engine reads the zone only with an active program", () => {
    expect(sectionComposition(demo.plan, 0)).toBeNull();
    const prog = instantiateExample(EXAMPLE_PROGRAMS[0], demo.plan!);
    const plan = { ...demo.plan!, sceneProgram: prog };
    expect(sectionComposition(plan, 0)?.zone).toBeTruthy();
    expect(sectionComposition({ ...plan, sceneProgram: { ...prog, enabled: false } }, 0)).toBeNull();
  });

  it("the key moment is the program's own, else 60 % into the first chorus", () => {
    const chorus = sections.find((s) => s.kind === "chorus")!;
    expect(keyMomentOf(demo.plan!, demo.meta.duration)).toBeCloseTo(chorus.start + (chorus.end - chorus.start) * 0.6);
    const prog = { ...instantiateExample(EXAMPLE_PROGRAMS[0], demo.plan!), keyMoment: 12 };
    expect(keyMomentOf({ ...demo.plan!, sceneProgram: prog }, demo.meta.duration)).toBe(12);
  });

  it("programFrame: per-section uniforms; an operator scene override or a disabled key shows the built-in scene", () => {
    const prog = instantiateExample(EXAMPLE_PROGRAMS[0], demo.plan!);
    const project = { ...demo, plan: { ...demo.plan!, sceneProgram: prog } };
    const chorusIdx = sections.findIndex((s) => s.kind === "chorus");
    const t = sections[chorusIdx].start + 1;
    const state = { ...initialStageState(project.id), t, sectionIndex: chorusIdx };
    const look = resolveLook(project, state, t);
    const pd = programFrame({ project, look, t, beat: 0.5, beatIndex: 6, master: 1, typeBox: [0.1, 0.2, 0.4, 0.3], typeAmt: 1 })!;
    expect(pd).not.toBeNull();
    expect(pd.mode).toBe(2);
    expect(pd.sectionKind).toBe(SECTION_KIND_CODE.chorus);
    expect(pd.bar).toBeCloseTo((2 + 0.5) / 4);
    // y flips to GL's uv (y up)
    expect(pd.typeBox[1]).toBeCloseTo(0.7);
    expect(pd.typeBox[3]).toBeCloseTo(0.8);
    expect(pd.zone[3]).toBeGreaterThan(pd.zone[1]);
    const forced = resolveLook(project, { ...state, overrides: { ...state.overrides, scene: "rain" } }, t);
    expect(programFrame({ project, look: forced, t, beat: 0, beatIndex: 0, master: 1, typeBox: null, typeAmt: 0 })).toBeNull();
    expect(programFrame({ project, look, t, beat: 0, beatIndex: 0, master: 1, typeBox: null, typeAmt: 0, disabled: new Set([pd.key]) })).toBeNull();
  });
});

import { KIND_DEFAULTS } from "./model";
function KIND_DEFAULTS_OF(kind: keyof typeof KIND_DEFAULTS) {
  return KIND_DEFAULTS[kind].params;
}
