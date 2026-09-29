import { describe, expect, it } from "vitest";
import { coerceMoodboard, colorDistance, extractMoodStats, fitWithin, hexRgb, kmeans, mergedMoodboard, moodSummary, sanitizeMoodStats } from "./moodboard";
import type { MoodImage } from "./types";

/** RGBA pixels: `parts` = [hex, share] filled in order (a flat image of stripes). */
function pixels(parts: Array<[string, number]>, n = 4000, alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(n * 4);
  let p = 0;
  for (const [hex, share] of parts) {
    const [r, g, b] = hexRgb(hex)!;
    const count = Math.round(n * share);
    for (let i = 0; i < count && p < n; i++, p++) data.set([r, g, b, alpha], p * 4);
  }
  return data;
}

const img = (id: string, stats?: MoodImage["stats"], note?: string): MoodImage => ({
  id,
  kind: "image",
  name: id,
  mimeType: "image/webp",
  file: `${id}.webp`,
  width: 800,
  height: 600,
  bytes: 1000,
  createdAt: "2026-09-01T00:00:00Z",
  ...(stats ? { stats } : {}),
  ...(note ? { note } : {}),
});

describe("mood board colour extraction", () => {
  it("finds the dominant colours with their shares, most frequent first", () => {
    const s = extractMoodStats(pixels([["#e8452c", 0.6], ["#1fa3a8", 0.3], ["#101020", 0.1]]));
    expect(s.palette).toHaveLength(3);
    expect(s.palette[0]).toBe("#e8452c");
    expect(s.palette[1]).toBe("#1fa3a8");
    expect(s.weights[0]).toBeCloseTo(0.6, 1);
    expect(s.weights[1]).toBeCloseTo(0.3, 1);
    expect(s.saturation).toBeGreaterThan(0.5);
    expect(s.warmth).toBeGreaterThan(0);
  });

  it("is deterministic and merges near-identical shades", () => {
    const data = pixels([["#e8452c", 0.4], ["#ea472e", 0.4], ["#202020", 0.2]]);
    const a = extractMoodStats(data);
    expect(extractMoodStats(data)).toEqual(a);
    expect(a.palette).toHaveLength(2);
    expect(colorDistance(hexRgb(a.palette[0])!, hexRgb("#e9462d")!)).toBeLessThan(4);
  });

  it("ignores transparent pixels and describes a grey image as unsaturated and neutral", () => {
    expect(extractMoodStats(pixels([["#ff0000", 1]], 100, 0)).palette).toEqual(["#000000"]);
    const grey = extractMoodStats(pixels([["#808080", 1]]));
    expect(grey.palette).toEqual(["#808080"]);
    expect(grey.saturation).toBe(0);
    expect(grey.warmth).toBe(0);
    expect(grey.luma).toBeCloseTo(0.502, 2);
  });

  it("k-means keeps at most k clusters", () => {
    const pts: Array<[number, number, number]> = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ];
    expect(kmeans(pts, [1, 1, 1, 1], 2)).toHaveLength(2);
    expect(kmeans([], [], 3)).toEqual([]);
  });

  it("fits the long edge inside 1024 px without upscaling", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(600, 2400)).toEqual({ width: 256, height: 1024 });
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe("stored mood boards", () => {
  it("sanitizes stats from the browser", () => {
    expect(sanitizeMoodStats({ palette: ["#FF0000", "nope", "#00ff00"], weights: [3, 9, 1], luma: 2, saturation: -1, warmth: 0.2 })).toEqual({
      palette: ["#ff0000", "#00ff00"],
      weights: [0.75, 0.25],
      luma: 1,
      saturation: 0,
      warmth: 0.2,
    });
    expect(sanitizeMoodStats({ palette: [] })).toBeUndefined();
    expect(sanitizeMoodStats("x")).toBeUndefined();
  });

  it("keeps images only, at most 12, with their stats and notes", () => {
    const list = coerceMoodboard([
      { ...img("aaaaaaaaaaa1"), stats: { palette: ["#123456"], weights: [1], luma: 0.1, saturation: 0.5, warmth: 0 }, note: "喜歡這個顏色", tags: ["x"] },
      { ...img("aaaaaaaaaaa2"), kind: "video", mimeType: "video/mp4", file: "aaaaaaaaaaa2.mp4", duration: 3 },
      { id: "../etc", file: "x" },
      ...Array.from({ length: 14 }, (_, i) => img(`bbbbbbbbbb${String(i).padStart(2, "0")}`)),
    ]);
    expect(list).toHaveLength(12);
    expect(list[0]).toMatchObject({ id: "aaaaaaaaaaa1", kind: "image", note: "喜歡這個顏色", stats: { palette: ["#123456"] } });
    expect(list[0].tags).toBeUndefined();
    expect(list.some((m) => m.id === "aaaaaaaaaaa2")).toBe(false);
    expect(coerceMoodboard([img("cccccccccccc")], "band")[0].scope).toBe("band");
    expect(coerceMoodboard(null)).toEqual([]);
  });

  it("puts the band's images first when merging", () => {
    const merged = mergedMoodboard({ moodboard: [img("p00000000001")], bandMoodboard: [img("b00000000001")] });
    expect(merged.map((m) => [m.id, m.scope])).toEqual([
      ["b00000000001", "band"],
      ["p00000000001", undefined],
    ]);
  });
});

describe("moodSummary", () => {
  it("reads the whole board; images whose note is about colour count double", () => {
    const red = { palette: ["#e8452c", "#101010"], weights: [0.5, 0.5], luma: 0.3, saturation: 0.6, warmth: 0.4 };
    const teal = { palette: ["#1fa3a8", "#f0f0f0"], weights: [0.5, 0.5], luma: 0.6, saturation: 0.4, warmth: -0.3 };
    const plain = moodSummary([img("a00000000001", red), img("a00000000002", teal)])!;
    const boosted = moodSummary([img("a00000000001", red, "喜歡這個顏色"), img("a00000000002", teal)])!;
    expect(plain.colors.length).toBeGreaterThanOrEqual(3);
    expect(boosted.warmth).toBeGreaterThan(plain.warmth);
    expect(boosted.vivid).toBe("#e8452c");
    expect(boosted.imageIds).toEqual(["a00000000001", "a00000000002"]);
    expect(moodSummary([img("a00000000003")])).toBeNull();
    expect(moodSummary(undefined)).toBeNull();
  });
});
