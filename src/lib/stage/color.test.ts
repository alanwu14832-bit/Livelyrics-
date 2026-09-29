import { describe, expect, it } from "vitest";
import { contrastRatio, ensureContrast, isHex, mixHex, parseHex, rgba, toHex } from "./color";

describe("color", () => {
  it("parses short and long hex", () => {
    expect(parseHex("#fff")).toEqual([1, 1, 1]);
    expect(toHex(parseHex("#1A2b3C"))).toBe("#1a2b3c");
    expect(parseHex("nope", [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]);
    expect(parseHex(undefined)).toEqual([0, 0, 0]);
    expect(isHex("#abc")).toBe(true);
    expect(isHex("abc1234")).toBe(false);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("ensureContrast lifts dark text on dark background", () => {
    const fixed = ensureContrast("#3a2b6b", "#07080d", 4.5);
    expect(contrastRatio(fixed, "#07080d")).toBeGreaterThanOrEqual(4.5);
    // already fine -> unchanged
    expect(ensureContrast("#ffffff", "#000000")).toBe("#ffffff");
    // light background pushes toward black
    const onLight = ensureContrast("#ffe0a0", "#fff8e8", 4.5);
    expect(contrastRatio(onLight, "#fff8e8")).toBeGreaterThanOrEqual(4.5);
  });

  it("mixes and formats", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(rgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });
});
