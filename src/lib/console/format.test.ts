import { describe, expect, it } from "vitest";
import { contrast, formatBpm, formatCountdown, formatOffset, hostOf, motifDataUrl, readableTextOn, withAlpha } from "./format";
import { peaksFromChannels } from "./peaks";

describe("format helpers", () => {
  it("formats offsets", () => {
    expect(formatOffset(0)).toBe("±0.00 s");
    expect(formatOffset(0.25)).toBe("+0.25 s");
    expect(formatOffset(-0.1)).toBe("−0.10 s");
    expect(formatOffset(0.001)).toBe("±0.00 s");
  });

  it("formats countdowns and bpm", () => {
    expect(formatCountdown(0)).toBe("現在");
    expect(formatCountdown(12.34)).toBe("12.3 秒後");
    expect(formatCountdown(185)).toBe("3 分 05 秒後");
    expect(formatBpm(120)).toBe("120");
    expect(formatBpm(92.44)).toBe("92.4");
    expect(formatBpm(0)).toBe("—");
  });

  it("chooses readable text colors", () => {
    expect(readableTextOn("#ffffff")).toBe("#0b0c10");
    expect(readableTextOn("#101018")).toBe("#ffffff");
    expect(readableTextOn("nope")).toBe("#ffffff");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
  });

  it("builds an inert motif data URL", () => {
    const url = motifDataUrl('<svg viewBox="0 0 100 100"><circle fill="currentColor" r="4"/></svg>', "#ff0000");
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const svg = decodeURIComponent(url!.split(",")[1]);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#ff0000"');
    expect(motifDataUrl("<div>no</div>", "#fff")).toBeNull();
    expect(motifDataUrl(null, "#fff")).toBeNull();
  });

  it("extracts hosts", () => {
    expect(hostOf("https://www.example.com/a")).toBe("example.com");
    expect(hostOf("not a url")).toBe("");
  });
});

describe("peaksFromChannels", () => {
  it("normalizes the loudest bucket to 1", () => {
    const ch = new Float32Array([0, 0.5, 0, -0.25, 0, 0.1, 0, 0]);
    expect(peaksFromChannels([ch], 4)).toEqual([1, 0.5, 0.2, 0]);
    expect(peaksFromChannels([], 4)).toEqual([]);
    expect(peaksFromChannels([new Float32Array(3)], 10)).toEqual([0, 0, 0]);
  });
});
