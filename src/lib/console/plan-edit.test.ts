import { describe, expect, it } from "vitest";
import { patchSection, sceneBank } from "./plan-edit";
import { section, testPlan } from "./test-fixtures";

describe("patchSection", () => {
  it("returns a new plan with only that section changed", () => {
    const plan = testPlan();
    const next = patchSection(plan, 1, { scene: "tunnel", lyricStyle: "impact", lyricPlacement: "upper-third", lyricScale: 1.234 });
    expect(next).not.toBe(plan);
    expect(next.sections[1]).toMatchObject({ scene: "tunnel", lyricStyle: "impact", lyricPlacement: "upper-third", lyricScale: 1.23 });
    expect(next.sections[0]).toBe(plan.sections[0]);
    expect(plan.sections[1].scene).toBe("nebula"); // not mutated
  });

  it("clamps lyric scale and ignores invalid values", () => {
    const plan = testPlan();
    expect(patchSection(plan, 0, { lyricScale: 5 }).sections[0].lyricScale).toBe(1.8);
    expect(patchSection(plan, 0, { lyricScale: 0.1 }).sections[0].lyricScale).toBe(0.6);
    // @ts-expect-error invalid scene id on purpose
    expect(patchSection(plan, 0, { scene: "lasers" })).toBe(plan);
    expect(patchSection(plan, 0, { lyricScale: Number.NaN })).toBe(plan);
    expect(patchSection(plan, 9, { scene: "grid" })).toBe(plan);
  });

  it("returns the same plan when nothing changes", () => {
    const plan = testPlan();
    expect(patchSection(plan, 0, { scene: "nebula", lyricScale: 1 })).toBe(plan);
  });
});

describe("sceneBank", () => {
  it("starts with the plan's scenes in order, without blackout, then fills to 9", () => {
    const plan = testPlan([
      section("s0", 0, 8, { scene: "bokeh" }),
      section("s1", 8, 16, { scene: "blackout" }),
      section("s2", 16, 24, { scene: "tunnel" }),
      section("s3", 24, 32, { scene: "bokeh" }),
    ]);
    const bank = sceneBank(plan);
    expect(bank).toHaveLength(9);
    expect(bank.slice(0, 4)).toEqual(["bokeh", "tunnel", "motif", "gradient"]);
    expect(bank).not.toContain("blackout");
    expect(new Set(bank).size).toBe(9);
  });

  it("works without a plan", () => {
    expect(sceneBank(null)).toHaveLength(9);
  });
});
