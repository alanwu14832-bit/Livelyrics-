// Round 12: the luminance probe and its CPU evaluator — a program that whites out the wall fails,
// the composer's forms (the pillars fix among them) and the hand-written examples pass, and the
// evaluator reads the GLSL subset the programs are written in.

import { describe, expect, it } from "vitest";
import type { SceneProgram } from "../../types";
import { composeSceneProgram, FORM_IDS } from "./composer";
import { EXAMPLE_PROGRAMS, instantiateExample } from "./examples";
import { compileForCpu, type Uniforms } from "./glsl-eval";
import { PROBE_LIT_MAX, PROBE_MEAN_MAX, probeSceneProgram } from "./probe";

const SECTIONS = [
  { id: "s0", kind: "intro" as const, energy: 0.25, start: 0, end: 8 },
  { id: "s1", kind: "verse" as const, energy: 0.45, start: 8, end: 24 },
  { id: "s2", kind: "chorus" as const, energy: 0.85, start: 24, end: 40 },
  { id: "s3", kind: "bridge" as const, energy: 0.5, start: 40, end: 48 },
  { id: "s4", kind: "chorus" as const, energy: 0.9, start: 48, end: 64 },
  { id: "s5", kind: "outro" as const, energy: 0.2, start: 64, end: 73 },
];

const manual = (source: string): SceneProgram => ({ version: 1, engine: "manual", title: "t", concept: "", source, sections: SECTIONS.map((s) => ({ sectionId: s.id, mode: s.kind === "chorus" ? 2 : 0, params: [0.5, 0.5, 0.5, 0.5], zone: { x: 0.08, y: 0.14, w: 0.4, h: 0.5 }, relation: "plain", note: "" })), keyMoment: null, enabled: true });

const uniforms = (over: Partial<Uniforms> = {}): Uniforms => ({
  uRes: [1920, 1080],
  uTime: 10,
  uClock: 10,
  uSongTime: 30,
  uSongProgress: 0.4,
  uSeed: 137,
  uBeat: 0.2,
  uBeatN: 40,
  uBar: 0.3,
  uTempo: 2,
  uPulse: 0,
  uEnergy: 0.5,
  uLevel: 0.3,
  uBass: 0.3,
  uOnset: 0,
  uIntensity: 0.8,
  uMaster: 1,
  uReact: 0.5,
  uSection: 1,
  uSectionKind: 1,
  uSectionEnergy: 0.5,
  uSectionProgress: 0.5,
  uMode: 0,
  uParams: [0.3, 0.35, 0.4, 0.4],
  uBg: [0.05, 0.06, 0.08],
  uPri: [0.3, 0.5, 0.7],
  uAcc: [0.9, 0.5, 0.2],
  uInk: [0.95, 0.95, 0.95],
  uPal: [
    [0.05, 0.06, 0.08],
    [0.3, 0.5, 0.7],
    [0.9, 0.5, 0.2],
    [0.95, 0.95, 0.95],
    [0.8, 0.7, 0.6],
    [0.1, 0.1, 0.15],
  ],
  uZone: [0.08, 0.3, 0.48, 0.86],
  uRelation: 0,
  uTypeBox: [0, 0, 0, 0],
  uTypeAmt: 0,
  ...over,
});

describe("the CPU evaluator", () => {
  it("reads swizzles, matrices, loops with break, functions with out parameters and the prelude", () => {
    const code = `
float twice(float x, out float y) { y = x * 2.0; return x; }
vec3 scene(vec2 fc) {
  vec2 p = centered(fc);
  vec2 q = rot(1.5707963) * vec2(0.0, 1.0);
  float acc = 0.0;
  for (int i = 0; i < 10; i++) { if (i >= 3) break; acc += 1.0; }
  float y = 0.0;
  twice(0.25, y);
  vec3 c = vec3(0.0);
  c.xz = vec2(q.x, acc / 10.0);
  c.y += y;
  c *= 1.0 - zoneMask(fc / uRes, 0.0);
  return c + uBg * 0.0 + vec3(sat(p.x) * 0.0);
}`;
    const prog = compileForCpu(code, uniforms());
    const { color } = prog.scene([1800, 100]);
    expect(color[0]).toBeCloseTo(1, 5);
    expect(color[1]).toBeCloseTo(0.5, 5);
    expect(color[2]).toBeCloseTo(0.3, 5);
    // inside the zone the mask is 1: everything multiplied away
    const inside = prog.scene([0.2 * 1920, 0.5 * 1080]);
    expect(inside.color).toEqual([0, 0, 0]);
  });

  it("applies the epilogue's master gain and clamp, and reads gFront", () => {
    const prog = compileForCpu("vec3 scene(vec2 fc) { gFront = 0.75; return vec3(0.6, 2.0, -1.0); }", uniforms({ uMaster: 1.2 }));
    const r = prog.scene([10, 10]);
    expect(r.color[0]).toBeCloseTo(0.72, 5);
    expect(r.color[1]).toBe(1);
    expect(r.color[2]).toBe(0);
    expect(r.front).toBe(0.75);
  });

  it("refuses what it cannot evaluate with a 繁中 message", () => {
    expect(() => compileForCpu("struct S { float a; }; vec3 scene(vec2 fc) { return vec3(0.0); }", uniforms())).toThrow(/struct/);
    expect(() => compileForCpu("vec3 scene(vec2 fc) { return nope(fc); }", uniforms())).toThrow(/未定義/);
  });
});

describe("the luminance probe", () => {
  it("fails a program that whites out the wall, with the section and the numbers", () => {
    const r = probeSceneProgram(manual("vec3 scene(vec2 fc) { return vec3(1.0); }"));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/亮部佔畫面 100%/);
    expect(r.errors[0]).toMatch(/s0/);
    expect(r.samples.every((s) => s.lit === 1)).toBe(true);
  });

  it("fails a flat mid-grey picture on its mean luminance", () => {
    const r = probeSceneProgram(manual("vec3 scene(vec2 fc) { return vec3(0.46); }"));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/平均亮度/);
    expect(r.samples[0].lit).toBe(0);
    expect(r.samples[0].mean).toBeGreaterThan(PROBE_MEAN_MAX);
  });

  it("warns, never fails, about a near-black section and a program it cannot evaluate", () => {
    const black = probeSceneProgram(manual("vec3 scene(vec2 fc) { return vec3(0.0); }"));
    expect(black.ok).toBe(true);
    expect(black.warnings[0]).toMatch(/幾乎全黑/);
    const odd = probeSceneProgram(manual("struct S { float a; }; vec3 scene(vec2 fc) { return vec3(0.0); }"));
    expect(odd.ok).toBe(true);
    expect(odd.unsupported).toMatch(/struct/);
    expect(odd.warnings[0]).toMatch(/無法評估/);
  });

  it("the audit's instrumental white-out is the thing the pillars fix removes: every form, every state, stays under the cap", { timeout: 90_000 }, () => {
    for (const form of FORM_IDS) {
      for (const seed of [11, 23]) {
        for (const lyrics of [true, false]) {
          const p = composeSceneProgram({ seed: seed * 7919, forms: [form], sections: SECTIONS, voice: "mv-card", lyrics });
          const r = probeSceneProgram(p, { sections: SECTIONS.map((s) => ({ ...s, colorway: ["#0b0d11", "#567aab", "#68a2c0"] })) as never });
          expect(r.unsupported, `${form}/${seed}`).toBeUndefined();
          expect(r.ok, `${form}/${seed}/${lyrics}: ${r.errors.join(";")}`).toBe(true);
          for (const s of r.samples) {
            expect(s.lit, `${form}/${seed} ${s.sectionId}`).toBeLessThanOrEqual(PROBE_LIT_MAX);
            // an instrumental verse is never a black screen
            if (!lyrics) expect(s.mean, `${form}/${seed} ${s.sectionId} black`).toBeGreaterThan(0.02);
          }
        }
      }
    }
  });

  it("the pillars' chorus is a lit protagonist in a dark frame: a small lit area, rays in the palette", () => {
    const p = composeSceneProgram({ seed: 4242, forms: ["pillars"], sections: SECTIONS, voice: "mv-card", lyrics: false });
    expect(p.source).not.toMatch(/mix\(uAcc, vec3\(1\.0\)/);
    expect(p.source).toContain("quiet(");
    expect(p.source).toContain("uSongTime / 8.0");
    const r = probeSceneProgram(p, { sections: SECTIONS.map((s) => ({ ...s, colorway: ["#0b0d11", "#567aab", "#68a2c0"] })) as never, grid: [64, 36] });
    const chorus = r.samples.find((s) => s.kind === "chorus")!;
    expect(chorus.lit).toBeLessThanOrEqual(0.15);
    expect(chorus.mean).toBeLessThan(0.3);
    const verse = r.samples.find((s) => s.kind === "verse")!;
    expect(verse.mean).toBeGreaterThan(0.03);
  });

  it("the hand-written examples pass (the prompt's quality references keep the wall dark)", () => {
    for (const ex of EXAMPLE_PROGRAMS) {
      const p = instantiateExample(ex, { sections: SECTIONS } as never);
      const r = probeSceneProgram(p);
      expect(r.unsupported, ex.id).toBeUndefined();
      expect(r.ok, `${ex.id}: ${r.errors.join(";")}`).toBe(true);
    }
  });
});
