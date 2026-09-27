import { describe, expect, it } from "vitest";
import { aspectLabel, fitCanvas, normalizeOutput, patchOutput, renderSize, safeRectPercent } from "./output";
import { adaptMetrics, placementBox, STYLE_METRICS } from "./stage/lyrics/layout";

describe("normalizeOutput / patchOutput", () => {
  it("defaults old projects to 1920 x 1080 with 5 % margins", () => {
    expect(normalizeOutput(undefined)).toEqual({ width: 1920, height: 1080, preset: "1080p", lyricSafe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 } });
  });

  it("applies presets, derives the preset from a size, clamps margins", () => {
    expect(normalizeOutput({ preset: "ultrawide" })).toMatchObject({ width: 3840, height: 1080, preset: "ultrawide" });
    expect(normalizeOutput({ width: 1080, height: 1920 })).toMatchObject({ preset: "portrait" });
    expect(normalizeOutput({ width: 2880, height: 1200.4 })).toMatchObject({ width: 2880, height: 1200, preset: "custom" });
    expect(normalizeOutput({ width: 10, height: 99999 })).toMatchObject({ width: 64, height: 16384 });
    expect(normalizeOutput({ lyricSafe: { top: 0.9, left: -1, right: "x" } }).lyricSafe).toEqual({ top: 0.3, right: 0.05, bottom: 0.05, left: 0 });
  });

  it("keeps custom mode while a size is typed and merges safe sides", () => {
    const custom = normalizeOutput({ preset: "custom", width: 1920, height: 1080 });
    expect(custom.preset).toBe("custom");
    expect(patchOutput(custom, { width: 2000 })).toMatchObject({ width: 2000, height: 1080, preset: "custom" });
    const hd = normalizeOutput(undefined);
    expect(patchOutput(hd, { width: 3840, height: 2160 }).preset).toBe("4k");
    expect(patchOutput(hd, { lyricSafe: { bottom: 0.2 } }).lyricSafe).toEqual({ top: 0.05, right: 0.05, bottom: 0.2, left: 0.05 });
  });

  it("labels aspects", () => {
    expect(aspectLabel(1920, 1080)).toBe("16:9");
    expect(aspectLabel(3840, 1080)).toBe("32:9");
    expect(aspectLabel(1920, 640)).toBe("3:1");
    expect(aspectLabel(1080, 1920)).toBe("9:16");
    expect(aspectLabel(1280, 1024)).toBe("5:4");
  });
});

describe("fitCanvas (letterbox / pillarbox)", () => {
  it("is pixel exact when the window is the canvas size", () => {
    expect(fitCanvas(3840, 1080, 3840, 1080, 1)).toEqual({ x: 0, y: 0, width: 3840, height: 1080 });
    expect(fitCanvas(1920, 540, 3840, 1080, 2)).toEqual({ x: 0, y: 0, width: 1920, height: 540 });
  });

  it("adds bars top and bottom for a wide canvas, left and right for a tall one", () => {
    expect(fitCanvas(1920, 1080, 3840, 1080, 1)).toEqual({ x: 0, y: 270, width: 1920, height: 540 });
    expect(fitCanvas(1920, 1080, 1080, 1920, 1)).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
    const r = fitCanvas(1000, 1000, 1920, 1080, 1.5);
    expect(r.width).toBeCloseTo(1000);
    expect(Math.round(r.height * 1.5)).toBe(r.height * 1.5); // whole physical pixels
  });
});

describe("renderSize", () => {
  it("never renders more pixels than the output canvas or the cap", () => {
    expect(renderSize(3840, 1080, 1, { width: 3840, height: 1080 }, 3840 * 2160)).toEqual([3840, 1080]);
    expect(renderSize(1920, 540, 2, { width: 1920, height: 540 }, 3840 * 2160)).toEqual([1920, 540]);
    const [w, h] = renderSize(3840, 2160, 1, { width: 3840, height: 2160 }, 2560 * 1440);
    expect(w * h).toBeLessThanOrEqual(2560 * 1440 + 4000);
  });
});

describe("lyric safe area and extreme aspects", () => {
  it("reproduces the designed boxes with the default 5 % margins", () => {
    expect(placementBox("center", "horizontal")).toEqual({ left: 5, top: 14, width: 90, height: 72, alignX: "center", alignY: "center" });
    expect(placementBox("lower-third", "horizontal")).toMatchObject({ left: 5, top: 58, width: 90, height: 32 });
  });

  it("maps boxes into a custom safe area", () => {
    const safe = { top: 0.1, right: 0.2, bottom: 0.1, left: 0 };
    const r = safeRectPercent(safe);
    expect(r).toEqual({ left: 0, top: 10, width: 80, height: 80 });
    const b = placementBox("center", "horizontal", safe);
    expect(b.left).toBeCloseTo(0);
    expect(b.left + b.width).toBeCloseTo(80);
    expect(b.top).toBeGreaterThanOrEqual(10);
    expect(b.top + b.height).toBeLessThanOrEqual(90);
  });

  it("leaves 16:9 metrics untouched", () => {
    const box = placementBox("center", "horizontal");
    for (const style of ["karaoke", "line-fade", "impact", "subtitle"] as const) {
      expect(adaptMetrics(STYLE_METRICS[style], style, box, 16 / 9, "horizontal")).toBe(STYLE_METRICS[style]);
    }
  });

  it("portrait canvases break into more, shorter rows instead of a tiny line", () => {
    const aspect = 1080 / 1920;
    const box = placementBox("center", "horizontal", undefined, aspect);
    const m = adaptMetrics(STYLE_METRICS["line-fade"], "line-fade", box, aspect, "horizontal");
    expect(m.maxChars).toBeLessThan(16);
    expect(m.maxChars).toBeGreaterThanOrEqual(6);
    expect(m.maxLines).toBeGreaterThan(2);
    // the rows fit the box width: chars x size (in canvas heights) <= box width in canvas heights
    expect(m.maxChars * (m.size / 100) * 1.06).toBeLessThanOrEqual((box.width / 100) * aspect + 1e-4);
    // and are still much bigger than shrinking a 16-char row would give
    const shrunk = ((box.width / 100) * aspect) / (16 * 1.06);
    expect(m.size / 100).toBeGreaterThan(shrunk * 1.3);
    const impact = adaptMetrics(STYLE_METRICS.impact, "impact", box, aspect, "horizontal");
    expect(impact.maxChars).toBeGreaterThanOrEqual(3);
    expect(impact.maxLines).toBeLessThanOrEqual(3);
  });

  it("ultra-wide strips use the width and cap the size to the box height", () => {
    const aspect = 3840 / 1080;
    const box = placementBox("lower-third", "horizontal", undefined, aspect);
    const base = STYLE_METRICS.karaoke;
    const m = adaptMetrics(base, "karaoke", box, aspect, "horizontal");
    expect(m.maxChars).toBeGreaterThan(base.maxChars);
    const rows = m.maxLines + (m.showNext ? 0.5 : 0);
    expect(rows * (m.size / 100) * m.leading).toBeLessThanOrEqual(box.height / 100 + 1e-6);
  });
});
