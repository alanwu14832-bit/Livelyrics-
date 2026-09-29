import { describe, expect, it } from "vitest";
import { parseCssColor, tokenAlpha } from "./canvas-tokens";

describe("parseCssColor", () => {
  it("parses hex forms", () => {
    expect(parseCssColor("#0071e3")).toEqual({ r: 0, g: 113, b: 227, a: 1 });
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(128 / 255, 5);
    expect(parseCssColor("#abcd")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 0xdd / 255 });
  });

  it("parses rgb()/rgba() with comma and space syntax", () => {
    expect(parseCssColor("rgba(235, 235, 245, 0.6)")).toEqual({ r: 235, g: 235, b: 245, a: 0.6 });
    expect(parseCssColor("rgb(60 60 67 / 30%)")).toEqual({ r: 60, g: 60, b: 67, a: 0.3 });
    expect(parseCssColor(" RGB(1, 2, 3) ")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("rejects anything else", () => {
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("#12345")).toBeNull();
    expect(parseCssColor("color-mix(in srgb, red, blue)")).toBeNull();
    expect(parseCssColor("rgb(1, 2)")).toBeNull();
  });
});

describe("tokenAlpha", () => {
  it("multiplies the existing alpha", () => {
    expect(tokenAlpha("rgba(84, 84, 88, 0.5)", 0.5)).toBe("rgba(84,84,88,0.25)");
    expect(tokenAlpha("#0a84ff", 0.3)).toBe("rgba(10,132,255,0.3)");
  });

  it("falls back to white for unknown input and clamps", () => {
    expect(tokenAlpha("nope", 2)).toBe("rgba(255,255,255,1)");
  });
});
