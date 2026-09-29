import { describe, expect, it } from "vitest";
import { DesignPlanSchema, type DesignPlan } from "@/lib/schema";
import { contrastRatio } from "./color";
import { FONT_CATALOG } from "./catalog";
import { normalizePlan, normalizePlanWithReport, repairTimeline } from "./normalize";
import { offlineDesign } from "./offline";
import { demoInput } from "./testing/fixtures";

const input = demoInput();

function assertCoverage(plan: DesignPlan, duration: number) {
  expect(plan.sections[0].start).toBe(0);
  expect(plan.sections[plan.sections.length - 1].end).toBe(duration);
  plan.sections.forEach((s, i) => {
    expect(s.id).toBe(`s${i}`);
    expect(s.end).toBeGreaterThan(s.start);
    if (i > 0) expect(s.start).toBe(plan.sections[i - 1].end);
  });
}

function assertInvariants(plan: DesignPlan, duration = 73) {
  expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
  assertCoverage(plan, duration);
  const hex = /^#[0-9a-f]{6}$/;
  expect(plan.keyVisual.palette.length).toBeGreaterThanOrEqual(4);
  expect(plan.keyVisual.palette.length).toBeLessThanOrEqual(6);
  for (const p of plan.keyVisual.palette) expect(p.hex).toMatch(hex);
  expect(FONT_CATALOG[plan.keyVisual.typography.cjkFont].cjk).toBe(true);
  expect(FONT_CATALOG[plan.keyVisual.typography.latinFont].cjk).toBe(false);
  expect(plan.keyVisual.typography.weight).toBeGreaterThanOrEqual(600);
  for (const s of plan.sections) {
    expect(s.colorway).toHaveLength(3);
    for (const c of s.colorway) expect(c).toMatch(hex);
    expect(s.lyricColor).toMatch(hex);
    expect(contrastRatio(s.lyricColor, s.colorway[0])).toBeGreaterThanOrEqual(4.5);
    for (const v of Object.values(s.sceneParams)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(s.energy).toBeGreaterThanOrEqual(0);
    expect(s.energy).toBeLessThanOrEqual(1);
    expect(s.lyricScale).toBeGreaterThanOrEqual(0.6);
    expect(s.lyricScale).toBeLessThanOrEqual(1.8);
  }
  for (let i = 1; i < plan.cues.length; i++) expect(plan.cues[i].time).toBeGreaterThanOrEqual(plan.cues[i - 1].time);
  for (const c of plan.cues) {
    expect(c.time).toBeGreaterThanOrEqual(0);
    expect(c.time).toBeLessThanOrEqual(duration);
  }
  expect(plan.cues.length).toBeGreaterThanOrEqual(3);
  expect(plan.cues.length).toBeLessThanOrEqual(12);
}

describe("normalizePlan", () => {
  it("turns garbage into a valid plan", () => {
    for (const raw of [null, undefined, 42, "plan", [], {}, { sections: "x", keyVisual: [] }]) {
      assertInvariants(normalizePlan(raw, input));
    }
  });

  it("keeps an already-valid plan intact", () => {
    const plan = offlineDesign(input);
    const again = normalizePlan(plan, input);
    expect(again).toEqual(plan);
  });

  it("sorts, closes gaps, resolves overlaps and merges tiny sections", () => {
    const base = offlineDesign(input);
    const s = base.sections;
    const messy = {
      ...base,
      sections: [
        { ...s[2], start: 26, end: 38 }, // gap before (24..26) and after
        { ...s[0], start: -5, end: 9 }, // negative start, overlaps next
        { ...s[1], start: 8, end: 24.5 },
        { ...s[3], start: 40.2, end: 41 }, // tiny, merged away
        { ...s[4], start: 41, end: 64 },
        { ...s[5], start: 64, end: 500 }, // past the end
        { ...s[5], start: 900, end: 950 }, // entirely after the song
        { ...s[5], start: "abc", end: 10 }, // unusable
      ],
    };
    const { plan, repairs } = normalizePlanWithReport(messy, input);
    assertInvariants(plan);
    expect(plan.sections.map((x) => [x.start, x.end])).toEqual([
      [0, 8],
      [8, 24],
      [24, 40],
      [40, 64],
      [64, 73],
    ]);
    expect(repairs.join("|")).toContain("段落時間");
  });

  it("repairTimeline snaps gaps to audio boundaries", () => {
    const out = repairTimeline(
      [
        { start: 0, end: 20 },
        { start: 30, end: 60 },
      ],
      60,
      [24],
    );
    expect(out).toEqual([
      { start: 0, end: 24 },
      { start: 24, end: 60 },
    ]);
  });

  it("fixes colors: colorway length, invalid hex, lyric contrast", () => {
    const base = offlineDesign(input);
    const broken = structuredClone(base) as unknown as Record<string, unknown> & DesignPlan;
    broken.keyVisual.palette = [
      { hex: "#FFF", role: "亮", name: "白" },
      { hex: "not-a-color", role: "x", name: "y" },
      { hex: "#FFFFFF", role: "dup", name: "dup" },
    ];
    broken.sections[0].colorway = ["#123"];
    broken.sections[1].colorway = ["#0a0a0a", "#ZZZZZZ", "#333333", "#444444", "#555555"];
    broken.sections[1].lyricColor = "#111111";
    broken.sections[2].lyricColor = "red";
    const { plan, repairs } = normalizePlanWithReport(broken, input);
    assertInvariants(plan);
    expect(plan.keyVisual.palette[0].hex).not.toBe("#ffffff"); // a dark background was put first
    expect(plan.sections[0].colorway[0]).toBe("#112233");
    expect(plan.sections[1].colorway).toEqual(["#0a0a0a", "#333333", "#444444"]);
    expect(repairs.some((r) => r.includes("無效的色碼"))).toBe(true);
    expect(repairs.some((r) => r.includes("對比"))).toBe(true);
  });

  it("repairs typography", () => {
    const base = offlineDesign(input);
    const swapped = structuredClone(base);
    swapped.keyVisual.typography = { ...swapped.keyVisual.typography, cjkFont: "anton", latinFont: "noto-serif-tc", weight: 200, letterSpacing: 5 };
    const t = normalizePlan(swapped, input).keyVisual.typography;
    expect(t.cjkFont).toBe("noto-serif-tc");
    expect(t.latinFont).toBe("anton");
    expect(t.weight).toBe(600);
    expect(t.letterSpacing).toBe(0.2);

    const bogus = structuredClone(base) as unknown as { keyVisual: { typography: Record<string, unknown> } };
    bogus.keyVisual.typography = { cjkFont: "comic-sans", latinFont: "noto-sans-tc", weight: "heavy" };
    const t2 = normalizePlan(bogus, input).keyVisual.typography;
    expect(t2.cjkFont).toBe("noto-sans-tc");
    expect(FONT_CATALOG[t2.latinFont].cjk).toBe(false);
    expect(t2.weight).toBe(700);
  });

  it("clamps numbers and coerces enums", () => {
    const base = offlineDesign(input);
    const raw = structuredClone(base) as unknown as { sections: Array<Record<string, unknown>> };
    raw.sections[0] = {
      ...raw.sections[0],
      energy: 7,
      lyricScale: 0.1,
      sceneParams: { speed: -1, density: "0.5", intensity: NaN, audioReactivity: 99 },
      scene: "Laser-Show",
      lyricStyle: "KARAOKE",
      kind: "Chorus",
      transitionIn: "explode",
    };
    const s0 = normalizePlan(raw, input).sections[0];
    expect(s0.energy).toBe(1);
    expect(s0.lyricScale).toBe(0.6);
    expect(s0.sceneParams.speed).toBe(0);
    expect(s0.sceneParams.density).toBe(0.5);
    expect(s0.sceneParams.audioReactivity).toBe(1);
    // a design output never keeps karaoke (字體藝術: every line is a composition) …
    expect(s0.lyricStyle).toBe("word-pop");
    // … a stored plan that is only shifted keeps its (coerced) legacy style
    expect(normalizePlan(raw, input, { typeSystem: "keep" }).sections[0].lyricStyle).toBe("karaoke");
    expect(s0.kind).toBe("chorus");
    expect(["cut", "fade", "flash", "wipe", "bloom"]).toContain(s0.transitionIn);
  });

  it("guesses a missing kind from the label", () => {
    const base = offlineDesign(input);
    const raw = structuredClone(base) as unknown as { sections: Array<Record<string, unknown>> };
    raw.sections[2] = { ...raw.sections[2], kind: "hook-ish", label: "副歌（大合唱）" };
    expect(normalizePlan(raw, input).sections[2].kind).toBe("chorus");
  });

  it("keeps vertical styles coherent", () => {
    const base = offlineDesign(input);
    base.sections[1] = { ...base.sections[1], lyricStyle: "vertical", lyricPlacement: "center" };
    expect(normalizePlan(base, input).sections[1].lyricPlacement).toBe("vertical-right");

    const english = demoInput();
    english.lyrics.lines = english.lyrics.lines.map((l) => ({ ...l, text: "Sing it loud tonight" }));
    const plan = offlineDesign(english);
    plan.sections[1] = { ...plan.sections[1], lyricStyle: "vertical", lyricPlacement: "vertical-left" };
    const fixed = normalizePlan(plan, english).sections[1];
    expect(fixed.lyricStyle).toBe("line-fade");
    expect(fixed.lyricPlacement).toBe("center");
  });

  it("drops unknown line ids and non-substring emphasis, merges duplicates", () => {
    const base = offlineDesign(input);
    const raw = {
      ...base,
      lines: [
        { lineId: "l999", emphasis: ["x"], styleOverride: null, note: "" },
        { lineId: "l4", emphasis: ["hey", "不存在", "  "], styleOverride: "IMPACT", note: "口號" },
        { lineId: "l4", emphasis: ["跟著我"], styleOverride: null, note: "第二則" },
        { lineId: "l5", emphasis: [], styleOverride: "bogus", note: "" },
        { lineId: "l1", emphasis: ["風"], styleOverride: null, note: "" },
      ],
    };
    const { plan, repairs } = normalizePlanWithReport(raw, input);
    expect(plan.lines).toEqual([
      { lineId: "l1", emphasis: ["風"], styleOverride: null, note: "" },
      { lineId: "l4", emphasis: ["Hey", "跟著我"], styleOverride: "impact", note: "口號；第二則" },
    ]);
    expect(repairs.some((r) => r.includes("不存在的歌詞行"))).toBe(true);
    expect(repairs.some((r) => r.includes("強調字"))).toBe(true);
  });

  it("clamps, sorts and tops up cues", () => {
    const base = offlineDesign(input);
    const plan = normalizePlan(
      {
        ...base,
        cues: [
          { time: 500, title: "尾", detail: "", kind: "warning" },
          { time: -3, title: "頭", detail: "", kind: "nope" },
        ],
      },
      input,
    );
    expect(plan.cues[0]).toMatchObject({ time: 0, kind: "highlight" });
    expect(plan.cues.some((c) => c.time === 73 && c.kind === "warning")).toBe(true);
    expect(plan.cues.length).toBeGreaterThanOrEqual(3);
    assertInvariants(plan);

    const many = normalizePlan(
      { ...base, cues: Array.from({ length: 30 }, (_, i) => ({ time: i * 2, title: `c${i}`, detail: "", kind: i % 5 === 0 ? "drop" : "highlight" })) },
      input,
    );
    expect(many.cues.length).toBe(12);
    expect(many.cues.filter((c) => c.kind === "drop").length).toBe(6);
  });

  it("replaces an unsafe motif with a generated emblem", () => {
    const base = offlineDesign(input);
    const plan = normalizePlan({ ...base, keyVisual: { ...base.keyVisual, motifSvg: '<svg onload="alert(1)"><script>alert(1)</script></svg>' } }, input);
    expect(plan.keyVisual.motifSvg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(plan.keyVisual.motifSvg).not.toMatch(/script|onload/);
  });

  it("uses meta duration when there is no analysis", () => {
    const noAnalysis = { ...demoInput(), analysis: null, meta: { ...demoInput().meta, duration: 80 } };
    const plan = normalizePlan(offlineDesign(input), noAnalysis);
    assertInvariants(plan, 80);
  });
});
