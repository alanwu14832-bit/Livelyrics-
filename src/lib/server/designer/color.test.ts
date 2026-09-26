import { describe, expect, it } from "vitest";
import { colorName, contrastRatio, ensureContrast, hexToHsl, hsl, normalizeHex, parseHex } from "./color";

describe("hex parsing", () => {
  it("accepts short, long, alpha and hash-less forms", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("aabbcc")).toBe("#aabbcc");
    expect(normalizeHex(" #AABBCCDD ")).toBe("#aabbcc");
    expect(normalizeHex("#abcd")).toBe("#aabbcc");
  });
  it("rejects anything else", () => {
    for (const bad of ["", "#ab", "#abcde", "red", "rgb(1,2,3)", "#gggggg", null, 12, undefined]) {
      expect(parseHex(bad)).toBeNull();
    }
  });
});

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("#123456", "#123456")).toBe(1);
  });

  it("keeps a passing preferred color", () => {
    expect(ensureContrast("#f6f1e7", "#0a0b1a", [])).toBe("#f6f1e7");
  });

  it("falls back to the best passing palette color, then neutrals", () => {
    const bg = "#0a0b1a";
    expect(ensureContrast("#1a1b2a", bg, ["#223344", "#ffc857", "#f6f1e7"])).toBe("#f6f1e7");
    expect(ensureContrast("#1a1b2a", bg, ["#223344"])).toBe("#ffffff");
    expect(ensureContrast("#eeeeee", "#fafafa", ["#dddddd"])).toBe("#0a0a0f");
  });

  it("always reaches 4.5:1, even on mid-grey backgrounds", () => {
    for (let v = 0; v <= 255; v += 5) {
      const bg = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      expect(contrastRatio(ensureContrast(null, bg, []), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("hsl", () => {
  it("round-trips", () => {
    const hex = hsl(210, 0.6, 0.5);
    const back = hexToHsl(hex);
    expect(back.h).toBeCloseTo(210, 0);
    expect(back.s).toBeCloseTo(0.6, 1);
    expect(back.l).toBeCloseTo(0.5, 1);
  });

  it("names colors in Traditional Chinese", () => {
    expect(colorName("#050510")).toMatch(/深夜|墨黑/);
    expect(colorName("#ffffff")).toBe("月白");
    expect(colorName(hsl(245, 0.6, 0.5)).length).toBeGreaterThan(0);
  });
});
