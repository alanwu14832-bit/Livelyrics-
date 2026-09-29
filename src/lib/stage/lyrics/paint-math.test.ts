import { describe, expect, it } from "vitest";
import {
  alignStart,
  baselineIn,
  caretVisible,
  deviceShadow,
  elementMatrix,
  isSidewaysChar,
  matteColor,
  multiply,
  parseColor,
  parseInset,
  parseMatrix,
  parseOrigin,
  parseTextShadows,
  scrimRect,
  transparentOf,
} from "./paint-math";

describe("CSS value parsing", () => {
  it("text-shadow lists, painted last to first", () => {
    const s = parseTextShadows("rgba(0, 0, 0, 0.62) 0px 2.4px 5.6px, rgba(10, 20, 30, 0.38) 0px 0px 36px");
    expect(s).toEqual([
      { color: "rgba(10, 20, 30, 0.38)", x: 0, y: 0, blur: 36 },
      { color: "rgba(0, 0, 0, 0.62)", x: 0, y: 2.4, blur: 5.6 },
    ]);
    expect(parseTextShadows("none")).toEqual([]);
  });

  it("transform matrices and origins", () => {
    expect(parseMatrix("none")).toEqual([1, 0, 0, 1, 0, 0]);
    expect(parseMatrix("matrix(1.2, 0, 0, 1.2, 0, -4.5)")).toEqual([1.2, 0, 0, 1.2, 0, -4.5]);
    expect(parseMatrix("matrix3d(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 5, 6, 0, 1)")).toEqual([2, 0, 0, 2, 5, 6]);
    expect(parseOrigin("50px 20px", 100, 40)).toEqual([50, 20]);
    expect(parseOrigin("50% 50%", 100, 40)).toEqual([50, 20]);
  });

  it("scales about the transform origin", () => {
    // scale(2) about the centre of a 100 x 40 box at (10, 10): the centre (60, 30) stays put
    const m = elementMatrix([2, 0, 0, 2, 0, 0], 10, 10, [50, 20]);
    const apply = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    expect(apply(60, 30)).toEqual([60, 30]);
    expect(apply(10, 10)).toEqual([-40, -10]);
    expect(multiply([1, 0, 0, 1, 5, 0], [2, 0, 0, 2, 0, 0])).toEqual([2, 0, 0, 2, 5, 0]);
  });

  it("karaoke clip insets", () => {
    expect(parseInset("inset(0px 37.5% 0px 0px)", 200, 50)).toEqual({ x: 0, y: 0, w: 125, h: 50 });
    expect(parseInset("inset(0px 0px 25% 0px)", 50, 200)).toEqual({ x: 0, y: 0, w: 50, h: 150 });
    expect(parseInset("inset(0 100% 0 0)", 80, 40)?.w).toBe(0);
    expect(parseInset("none", 10, 10)).toBeNull();
  });

  it("colours", () => {
    expect(parseColor("rgb(255, 128, 0)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.5)").a).toBe(0.5);
    expect(parseColor("#ff000080").a).toBeCloseTo(0.5, 2);
    expect(transparentOf("rgba(10, 20, 30, 0.4)")).toBe("rgba(10, 20, 30, 0)");
    expect(matteColor("rgba(200, 100, 0, 0.5)")).toBe("rgba(255, 255, 255, 0.5)");
    expect(matteColor("rgb(200, 100, 0)")).toBe("rgba(255, 255, 255, 1)");
  });
});

describe("lyric painter layout math", () => {
  it("places the baseline with CSS half-leading", () => {
    // 100 px font, line-height 124 px, ascent 88 + descent 24 = 112: half-leading 6
    expect(baselineIn(10, 124, 88, 24)).toBe(10 + 6 + 88);
    // a tight line-height (impact, 1.02) moves the baseline up, never outside the box math
    expect(baselineIn(0, 102, 88, 24)).toBe(-5 + 88);
  });

  it("aligns runs like text-align", () => {
    expect(alignStart(0, 100, 40, "center")).toBe(30);
    expect(alignStart(0, 100, 40, "start")).toBe(0);
    expect(alignStart(0, 100, 40, "end")).toBe(60);
    expect(alignStart(10, 100, 40, "right")).toBe(70);
  });

  it("scrim ellipse covers the block plus 1.1em / 0.5em", () => {
    const r = scrimRect(100, 50, 400, 120, 60);
    expect(r).toMatchObject({ x: 34, y: 20, w: 532, h: 180, cx: 300, cy: 110, rx: 266, ry: 90 });
  });

  it("shadows follow the element's transform (canvas shadows are in device space)", () => {
    const shadow = { color: "#000", x: 0, y: 3, blur: 6 };
    expect(deviceShadow(shadow, [1, 0, 0, 1, 0, 0], 1000)).toEqual({ offsetX: 1000, offsetY: 3, blur: 6 });
    // scale(2): offset and blur double
    expect(deviceShadow(shadow, [2, 0, 0, 2, 0, 0], 1000)).toEqual({ offsetX: 1000, offsetY: 6, blur: 12 });
    // rotated 90°: a downward offset becomes a leftward one
    const r = deviceShadow(shadow, [0, 1, -1, 0, 0, 0], 1000);
    expect(r.offsetX).toBeCloseTo(997);
    expect(r.offsetY).toBeCloseTo(0);
  });

  it("vertical text: Latin sideways, CJK and full-width punctuation upright", () => {
    expect(isSidewaysChar("A")).toBe(true);
    expect(isSidewaysChar("7")).toBe(true);
    expect(isSidewaysChar("夜")).toBe(false);
    expect(isSidewaysChar("，")).toBe(false);
    expect(isSidewaysChar("、")).toBe(false);
  });

  it("caret blink follows song time", () => {
    expect(caretVisible(0)).toBe(true);
    expect(caretVisible(0.3)).toBe(true);
    expect(caretVisible(0.7)).toBe(false);
    expect(caretVisible(1.2)).toBe(true);
  });
});
