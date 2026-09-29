import { describe, expect, it } from "vitest";
import { applyBiblePatch, bibleHasContent, coerceBand, coerceBible, defaultBible, normalizeBibleHex, sanitizePalette } from "./band";

describe("band bible coercion", () => {
  it("fills defaults for missing or malformed fields", () => {
    const b = coerceBible({ palette: ["#FFF", "nope", { hex: "123456", role: "背景" }], sceneAffinity: ["nebula", "nope", "nebula"], sceneAvoid: ["nebula", "tunnel"], fonts: { cjkFont: "anton", latinFont: "noto-sans-tc", weight: 1200 } });
    expect(b.palette.map((c) => c.hex)).toEqual(["#ffffff", "#123456"]);
    expect(b.sceneAffinity).toEqual(["nebula"]);
    // a scene is preferred or avoided, never both
    expect(b.sceneAvoid).toEqual(["tunnel"]);
    // a Latin font cannot be the CJK font and vice versa; weights are clamped
    expect(b.fonts).toEqual({ cjkFont: "noto-sans-tc", latinFont: "space-grotesk", weight: 900 });
    expect(b.lyricPolicy.mode).toBe("chorus-only");
    expect(coerceBible(null)).toEqual(defaultBible());
  });

  it("normalizes hex colours", () => {
    expect(normalizeBibleHex("ABC")).toBe("#aabbcc");
    expect(normalizeBibleHex("#12345g")).toBeNull();
    expect(sanitizePalette(Array.from({ length: 12 }, (_, i) => `#0000${String(i).padStart(2, "0")}`))).toHaveLength(8);
  });

  it("coerces a band file and marks its assets as band scope", () => {
    const band = coerceBand({ name: "  夜行  ", assets: [{ id: "a1b2c3d4e5f6", file: "a1b2c3d4e5f6.png", kind: "logo", mimeType: "image/png", width: 10, height: 10, bytes: 5 }, { id: "bad" }] }, "b1", "2026-01-01T00:00:00.000Z");
    expect(band.name).toBe("夜行");
    expect(band.assets).toHaveLength(1);
    expect(band.assets[0].scope).toBe("band");
    expect(band.bible).toEqual(defaultBible());
    expect(bibleHasContent(band.bible)).toBe(false);
  });

  it("applies partial edits and records a manual source", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const r = applyBiblePatch(defaultBible(), { summary: "## 世界觀\n霧", sceneAffinity: ["ink"], palette: [{ hex: "#101010" }, { hex: "#fafafa", name: "月光" }] }, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bible.summary).toBe("## 世界觀\n霧");
    expect(r.bible.palette[1].name).toBe("月光");
    expect(r.bible.source).toEqual({ engine: "manual", updatedAt: now.toISOString() });
    expect(bibleHasContent(r.bible)).toBe(true);
    // avoiding a preferred scene moves it
    const r2 = applyBiblePatch(r.bible, { sceneAvoid: ["ink"] });
    expect(r2.ok && r2.bible.sceneAffinity).toEqual([]);
    expect(r2.ok && r2.bible.sceneAvoid).toEqual(["ink"]);
    expect(applyBiblePatch(defaultBible(), { palette: [{ hex: "zz" }] }).ok).toBe(false);
    expect(applyBiblePatch(defaultBible(), { motifs: "x" }).ok).toBe(false);
  });
});
