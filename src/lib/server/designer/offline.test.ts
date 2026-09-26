import { describe, expect, it } from "vitest";
import { DesignPlanSchema } from "@/lib/schema";
import type { Lyrics } from "@/lib/types";
import { contrastRatio } from "./color";
import { offlineDesign, offlineResearch } from "./offline";
import { sanitizeSvg } from "./svg";
import { demoAnalysis, demoInput, demoLyrics, demoMeta } from "./testing/fixtures";

describe("offlineDesign on the demo song", () => {
  const plan = offlineDesign(demoInput());

  it("passes the schema and covers 0..duration exactly", () => {
    expect(() => DesignPlanSchema.parse(plan)).not.toThrow();
    expect(plan.sections[0].start).toBe(0);
    expect(plan.sections[plan.sections.length - 1].end).toBe(73);
    for (let i = 1; i < plan.sections.length; i++) expect(plan.sections[i].start).toBe(plan.sections[i - 1].end);
  });

  it("follows the song structure", () => {
    expect(plan.sections.map((s) => s.kind)).toEqual(["intro", "verse", "chorus", "breakdown", "chorus", "outro"]);
    expect(plan.sections.map((s) => [s.start, s.end])).toEqual([
      [0, 8],
      [8, 24],
      [24, 40],
      [40, 48],
      [48, 64],
      [64, 73],
    ]);
  });

  it("makes design choices a stage designer would", () => {
    const [intro, verse, chorus1, breakdown, chorus2, outro] = plan.sections;
    expect(intro.lyricStyle).toBe("hidden");
    expect(intro.scene).toBe("motif");
    expect(outro.scene).toBe("motif");
    expect(["line-fade", "stack", "subtitle"]).toContain(verse.lyricStyle);
    expect(["karaoke", "impact", "word-pop"]).toContain(chorus1.lyricStyle);
    expect(["karaoke", "impact", "word-pop"]).toContain(chorus2.lyricStyle);
    expect(["tunnel", "grid", "shards", "particles"]).toContain(chorus1.scene);
    // the last chorus escalates
    expect(chorus2.sceneParams.intensity).toBeGreaterThanOrEqual(chorus1.sceneParams.intensity);
    expect(["rain", "gradient", "ink", "blackout", "nebula"]).toContain(breakdown.scene);
    expect(breakdown.sceneParams.intensity).toBeLessThan(chorus1.sceneParams.intensity);
    expect(chorus1.transitionIn).toBe("flash");
    // no two adjacent sections share a scene
    for (let i = 1; i < plan.sections.length; i++) expect(plan.sections[i].scene).not.toBe(plan.sections[i - 1].scene);
  });

  it("has legible typography and strong lyric contrast", () => {
    expect(plan.keyVisual.typography.weight).toBeGreaterThanOrEqual(600);
    for (const s of plan.sections) expect(contrastRatio(s.lyricColor, s.colorway[0])).toBeGreaterThanOrEqual(4.5);
    expect(plan.keyVisual.palette.length).toBeGreaterThanOrEqual(4);
  });

  it("writes Traditional-Chinese key visual, notes and cues", () => {
    expect(plan.keyVisual.title.length).toBeGreaterThanOrEqual(3);
    expect(plan.keyVisual.title.length).toBeLessThanOrEqual(12);
    expect(plan.keyVisual.moodKeywords.length).toBeGreaterThanOrEqual(3);
    expect(plan.keyVisual.motifs.length).toBeGreaterThanOrEqual(2);
    expect(plan.designerNotes).toContain("離線設計師");
    expect(plan.designerNotes.length).toBeGreaterThan(150);
    const kinds = new Set(plan.cues.map((c) => c.kind));
    expect(kinds.has("singalong")).toBe(true);
    expect(kinds.has("drop")).toBe(true);
    expect(kinds.has("warning")).toBe(true);
    expect(plan.cues.length).toBeLessThanOrEqual(12);
  });

  it("emphasizes the hook and imagery", () => {
    const l4 = plan.lines.find((l) => l.lineId === "l4");
    expect(l4?.emphasis).toContain("Hey");
    for (const l of plan.lines) {
      const text = demoLyrics().lines.find((x) => x.id === l.lineId)?.text ?? "";
      for (const e of l.emphasis) expect(text).toContain(e);
    }
  });

  it("generates a sanitizer-clean motif", () => {
    expect(sanitizeSvg(plan.keyVisual.motifSvg)).toBe(plan.keyVisual.motifSvg);
  });

  it("is deterministic", () => {
    expect(offlineDesign(demoInput())).toEqual(plan);
  });

  it("varies with the song identity", () => {
    const other = offlineDesign({ ...demoInput(), meta: demoMeta({ title: "完全不同的歌", artist: "另一個樂團" }) });
    expect(other.keyVisual.palette.map((p) => p.hex)).not.toEqual(plan.keyVisual.palette.map((p) => p.hex));
  });
});

describe("offlineDesign edge cases", () => {
  it("works without analysis, without timing and without lyrics", () => {
    const cases = [
      { ...demoInput(), analysis: null },
      { ...demoInput(), lyrics: { source: "user", synced: false, lines: demoLyrics().lines.map((l) => ({ ...l, start: null, end: null })) } as Lyrics },
      { ...demoInput(), lyrics: { source: "none", synced: false, lines: [] } as Lyrics },
      { meta: demoMeta({ duration: 0, title: "", artist: "" }), lyrics: { source: "none", synced: false, lines: [] } as Lyrics, analysis: null },
    ];
    for (const c of cases) {
      const p = offlineDesign(c);
      expect(DesignPlanSchema.safeParse(p).success).toBe(true);
      expect(p.sections[0].start).toBe(0);
    }
  });

  it("handles a long through-composed song", () => {
    const analysis = demoAnalysis();
    const lines = Array.from({ length: 60 }, (_, i) => ({ id: `l${i}`, text: `第${i}句獨一無二的歌詞在這裡`, start: 4 + i * 1.1, end: null }));
    const p = offlineDesign({ meta: demoMeta(), lyrics: { source: "user", synced: true, lines }, analysis });
    expect(DesignPlanSchema.safeParse(p).success).toBe(true);
    // dense sections fall back to calmer lyric styles
    expect(p.sections.some((s) => s.lyricStyle === "subtitle" || s.lyricStyle === "karaoke")).toBe(true);
  });
});

describe("offlineResearch", () => {
  it("uses the fixed headings and explains how to enable Claude", () => {
    const r = offlineResearch(demoInput());
    expect(r.engine).toBe("offline");
    expect(r.sources).toEqual([]);
    for (const h of ["## 樂團視覺識別", "## 歌曲意象與情緒", "## 現場表演觀察", "## 設計方向建議", "## 參考來源"]) expect(r.brief).toContain(h);
    expect(r.brief).toContain("ANTHROPIC_API_KEY");
    expect(r.brief).toContain("120 BPM");
    // never reproduces full lyric lines
    for (const l of demoLyrics().lines) expect(r.brief).not.toContain(l.text);
  });

  it("mentions the fallback reason", () => {
    expect(offlineResearch(demoInput(), "Claude 暫時無法使用").brief).toContain("Claude 暫時無法使用");
  });
});
