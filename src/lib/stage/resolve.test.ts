import { describe, expect, it } from "vitest";
import { DesignPlanSchema } from "../schema";
import { contrastRatio } from "./color";
import { createDemoProject } from "./demo";
import { initialStageState, type StageState } from "./protocol";
import { resolveLineDesign, resolveLook, resolveSectionIndex } from "./resolve";

const project = createDemoProject();
const state = (patch: Partial<StageState> = {}): StageState => ({ ...initialStageState("demo"), ...patch });

describe("demo project", () => {
  it("is a valid DesignPlan covering the song", () => {
    expect(() => DesignPlanSchema.parse(project.plan)).not.toThrow();
    const secs = project.plan!.sections;
    expect(secs[0].start).toBe(0);
    expect(secs[secs.length - 1].end).toBe(project.meta.duration);
    for (let i = 1; i < secs.length; i++) expect(secs[i].start).toBe(secs[i - 1].end);
    expect(project.analysis!.energy.length).toBe(Math.ceil(73 * 20));
  });
});

describe("resolveLook", () => {
  it("prefers the console's sectionIndex, falls back to time", () => {
    expect(resolveSectionIndex(project.plan, state({ sectionIndex: 3 }), 0)).toBe(3);
    expect(resolveSectionIndex(project.plan, state({ sectionIndex: null }), 30)).toBe(2);
    expect(resolveSectionIndex(project.plan, state({ sectionIndex: 99 }), 50)).toBe(4);
    expect(resolveSectionIndex(null, state(), 50)).toBeNull();
  });

  it("applies scene and scale overrides", () => {
    const look = resolveLook(project, state({ overrides: { ...state().overrides, scene: "rain", lyricScale: 2 } }), 30);
    expect(look.scene).toBe("rain");
    expect(look.lyricStyle).toBe("word-pop");
    expect(look.lyricScale).toBeCloseTo(1.1 * 2);
    expect(look.colorway).toHaveLength(3);
    expect(contrastRatio(look.lyricColor, look.colorway[0])).toBeGreaterThanOrEqual(4.5);
  });

  it("has a sane default look without a plan", () => {
    const look = resolveLook({ ...project, plan: null }, state(), 10);
    expect(look.scene).toBe("gradient");
    expect(look.sectionIndex).toBeNull();
    expect(look.lyricStyle).toBe("line-fade");
  });

  it("repairs malformed plan values", () => {
    const plan = structuredClone(project.plan!);
    plan.sections[0].colorway = ["bad", "#123456"] as unknown as string[];
    plan.sections[0].lyricColor = "#0a0b1b";
    plan.sections[0].sceneParams.speed = Number.NaN;
    const look = resolveLook({ ...project, plan }, state(), 1);
    expect(look.colorway[0]).toBe("#0a0b1a"); // falls back to palette[0]
    expect(look.colorway[1]).toBe("#123456");
    expect(look.params.speed).toBeCloseTo(0.35);
    expect(contrastRatio(look.lyricColor, look.colorway[0])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("resolveLineDesign", () => {
  it("operator override > line override > section style", () => {
    expect(resolveLineDesign(project.plan, "l4", "word-pop", null)).toEqual({ style: "impact", emphasis: ["Hey"] });
    expect(resolveLineDesign(project.plan, "l4", "word-pop", "subtitle").style).toBe("subtitle");
    expect(resolveLineDesign(project.plan, "l6", "word-pop", undefined)).toEqual({ style: "word-pop", emphasis: [] });
  });
});
