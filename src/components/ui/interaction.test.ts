import { describe, expect, it } from "vitest";
import {
  ariaKeyShortcut,
  capsuleOverflow,
  createTypeahead,
  decimalsOf,
  keyLabel,
  mergePresence,
  percentOf,
  placeFloating,
  rovingIndex,
  segmentAt,
  sliderKeyDelta,
  stackOffsets,
  stepValue,
  tooltipTiming,
} from "./interaction";

describe("rovingIndex", () => {
  it("moves with arrows and wraps by default", () => {
    expect(rovingIndex("ArrowRight", 0, 3)).toBe(1);
    expect(rovingIndex("ArrowRight", 2, 3)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(rovingIndex("ArrowDown", 1, 3)).toBe(2);
    expect(rovingIndex("ArrowUp", 1, 3)).toBe(0);
  });
  it("Home and End go to the first and last enabled item", () => {
    const isDisabled = (i: number) => i === 0 || i === 3;
    expect(rovingIndex("Home", 2, 4, { isDisabled })).toBe(1);
    expect(rovingIndex("End", 1, 4, { isDisabled })).toBe(2);
  });
  it("skips disabled items", () => {
    expect(rovingIndex("ArrowRight", 0, 4, { isDisabled: (i) => i === 1 })).toBe(2);
    expect(rovingIndex("ArrowLeft", 0, 4, { isDisabled: (i) => i === 3 })).toBe(2);
  });
  it("respects orientation", () => {
    expect(rovingIndex("ArrowDown", 0, 3, { orientation: "horizontal" })).toBeNull();
    expect(rovingIndex("ArrowRight", 0, 3, { orientation: "vertical" })).toBeNull();
    expect(rovingIndex("ArrowDown", 0, 3, { orientation: "vertical" })).toBe(1);
  });
  it("stops at the ends without loop", () => {
    expect(rovingIndex("ArrowRight", 2, 3, { loop: false })).toBe(2);
    expect(rovingIndex("ArrowLeft", 0, 3, { loop: false })).toBe(0);
  });
  it("starts from the edges when nothing is current", () => {
    expect(rovingIndex("ArrowDown", -1, 3)).toBe(0);
    expect(rovingIndex("ArrowUp", -1, 3)).toBe(2);
  });
  it("ignores other keys and empty groups", () => {
    expect(rovingIndex("a", 0, 3)).toBeNull();
    expect(rovingIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("createTypeahead", () => {
  const labels = ["Apple", "Banana", "Blueberry", "Cherry"];
  it("jumps to the next item starting with the typed letter and cycles on repeats", () => {
    const t = createTypeahead();
    expect(t.next("b", 0, labels, 0)).toBe(1);
    expect(t.next("b", 100, labels, 1)).toBe(2);
    expect(t.next("b", 200, labels, 2)).toBe(1);
  });
  it("builds a prefix within the timeout and resets after it", () => {
    const t = createTypeahead(500);
    expect(t.next("b", 0, labels, 0)).toBe(1);
    expect(t.next("l", 100, labels, 1)).toBe(2);
    expect(t.next("c", 1000, labels, 2)).toBe(3);
  });
  it("returns null without a match or for space", () => {
    const t = createTypeahead();
    expect(t.next("z", 0, labels, 0)).toBeNull();
    expect(t.next(" ", 0, labels, 0)).toBeNull();
  });
});

describe("numbers", () => {
  it("decimalsOf", () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.05)).toBe(2);
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(1e-7)).toBe(7);
  });
  it("stepValue rounds to the step precision and clamps", () => {
    let v = 0;
    for (let i = 0; i < 7; i++) v = stepValue(v, 0.05);
    expect(v).toBe(0.35);
    expect(stepValue(0.3, 0.1)).toBe(0.4);
    expect(stepValue(0.98, 0.05, { max: 1 })).toBe(1);
    expect(stepValue(-0.02, -0.05, { min: -0.05 })).toBe(-0.05);
    expect(stepValue(0.12, 0.01, { precisionStep: 0.05 })).toBe(0.13);
  });
  it("sliderKeyDelta: one step, ten with Shift, null for other keys", () => {
    expect(sliderKeyDelta("ArrowRight", false, 0.05)).toBeCloseTo(0.05);
    expect(sliderKeyDelta("ArrowDown", true, 0.05)).toBeCloseTo(-0.5);
    expect(sliderKeyDelta("Home", false, 1)).toBeNull();
  });
  it("percentOf", () => {
    expect(percentOf(5, 0, 10)).toBe(50);
    expect(percentOf(-1, 0, 10)).toBe(0);
    expect(percentOf(3, 3, 3)).toBe(0);
  });
  it("segmentAt maps a pointer x to a segment and clamps", () => {
    expect(segmentAt(10, 0, 302, 3)).toBe(0);
    expect(segmentAt(151, 0, 302, 3)).toBe(1);
    expect(segmentAt(300, 0, 302, 3)).toBe(2);
    expect(segmentAt(-40, 0, 302, 3)).toBe(0);
    expect(segmentAt(900, 0, 302, 3)).toBe(2);
  });
});

describe("placeFloating", () => {
  const viewport = { width: 1000, height: 800 };
  it("puts a bottom-start menu under the trigger, origin at the trigger", () => {
    const p = placeFloating({ anchor: { left: 100, top: 100, width: 40, height: 28 }, floating: { width: 200, height: 150 }, viewport });
    expect(p).toMatchObject({ left: 100, top: 134, side: "bottom" });
    expect(p.origin).toBe("20px 0px");
  });
  it("bottom-end aligns right edges", () => {
    const p = placeFloating({ anchor: { left: 700, top: 100, width: 28, height: 28 }, floating: { width: 200, height: 100 }, viewport, placement: "bottom-end" });
    expect(p.left).toBe(528);
  });
  it("flips to the top when there is no room below", () => {
    const p = placeFloating({ anchor: { left: 100, top: 700, width: 40, height: 28 }, floating: { width: 200, height: 150 }, viewport });
    expect(p.side).toBe("top");
    expect(p.top).toBe(700 - 6 - 150);
    expect(p.origin).toBe("20px 150px");
  });
  it("clamps into the viewport margin", () => {
    const p = placeFloating({ anchor: { left: 980, top: 100, width: 10, height: 10 }, floating: { width: 200, height: 50 }, viewport, placement: "bottom" });
    expect(p.left).toBe(1000 - 8 - 200);
  });
  it("centres tooltips", () => {
    const p = placeFloating({ anchor: { left: 400, top: 100, width: 100, height: 30 }, floating: { width: 60, height: 24 }, viewport, placement: "bottom" });
    expect(p.left).toBe(420);
    expect(p.align).toBe("center");
  });
});

describe("tooltipTiming", () => {
  it("waits for the first tooltip", () => {
    expect(tooltipTiming({ now: 10_000, lastClosedAt: 0, anyOpen: false })).toEqual({ delay: 400, instant: false });
  });
  it("is instant while one is open or right after one closed", () => {
    expect(tooltipTiming({ now: 10_000, lastClosedAt: 0, anyOpen: true })).toEqual({ delay: 0, instant: true });
    expect(tooltipTiming({ now: 10_500, lastClosedAt: 10_000, anyOpen: false })).toEqual({ delay: 0, instant: true });
    expect(tooltipTiming({ now: 10_700, lastClosedAt: 10_000, anyOpen: false }).instant).toBe(false);
  });
});

describe("stacks and presence", () => {
  it("stackOffsets", () => {
    expect(stackOffsets([40, 60, 50], 8)).toEqual([0, 48, 116]);
    expect(stackOffsets([])).toEqual([]);
  });
  it("mergePresence keeps leaving items in place, flagged", () => {
    const k = (s: string) => s;
    const first = mergePresence([], ["a", "b", "c"], k);
    expect(first.map((p) => p.key)).toEqual(["a", "b", "c"]);
    const second = mergePresence(first, ["a", "c"], k);
    expect(second.map((p) => `${p.key}${p.exiting ? "-" : ""}`)).toEqual(["a", "b-", "c"]);
    const third = mergePresence(second, ["d", "a", "b", "c"], k);
    expect(third.every((p) => !p.exiting)).toBe(true);
    expect(third.map((p) => p.key)).toEqual(["d", "a", "b", "c"]);
    const fourth = mergePresence(third, [], k);
    expect(fourth.map((p) => p.key)).toEqual(["d", "a", "b", "c"]);
    expect(fourth.every((p) => p.exiting)).toBe(true);
  });
  it("capsuleOverflow collapses into +n", () => {
    expect(capsuleOverflow([1, 2, 3], 3)).toEqual({ visible: [1, 2, 3], overflow: [] });
    expect(capsuleOverflow([1, 2, 3, 4, 5], 3)).toEqual({ visible: [1, 2], overflow: [3, 4, 5] });
  });
});

describe("keyLabel", () => {
  it("maps names to macOS glyphs in modifier order", () => {
    expect(keyLabel("Shift+ArrowUp")).toBe("⇧↑");
    expect(keyLabel("Meta+Shift+s")).toBe("⇧⌘S");
    expect(keyLabel("Ctrl+Alt+Delete")).toBe("⌃⌥⌫");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel(" ")).toBe("Space");
    expect(keyLabel("b")).toBe("B");
    expect(keyLabel("[")).toBe("[");
    expect(keyLabel("Shift++")).toBe("⇧+");
    expect(keyLabel("Escape")).toBe("Esc");
  });
  it("ariaKeyShortcut", () => {
    expect(ariaKeyShortcut("Cmd+s")).toBe("Meta+S");
    expect(ariaKeyShortcut("b")).toBe("B");
    expect(ariaKeyShortcut("Shift+ArrowUp")).toBe("Shift+ArrowUp");
  });
});
