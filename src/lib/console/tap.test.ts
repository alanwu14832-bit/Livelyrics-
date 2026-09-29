import { describe, expect, it } from "vitest";
import { TapClock } from "./tap";

describe("TapClock", () => {
  it("derives the tempo from the median interval", () => {
    const c = new TapClock();
    expect(c.tap(10)).toBeNull();
    expect(c.tap(10.5)).toBe(120);
    c.tap(11.0);
    c.tap(11.52); // a slightly late tap does not move the median much
    c.tap(12.0);
    expect(c.bpm).toBeCloseTo(120, 0);
    expect(c.count).toBe(5);
  });

  it("anchors the phase to the last tap", () => {
    const c = new TapClock();
    c.tap(0);
    c.tap(0.5);
    expect(c.phase(0.5)).toBeCloseTo(0);
    expect(c.phase(0.75)).toBeCloseTo(0.5);
    expect(c.phase(1.0)).toBeCloseTo(0);
  });

  it("starts over after a long pause and ignores bounces", () => {
    const c = new TapClock();
    c.tap(0);
    c.tap(0.5);
    c.tap(0.55); // bounce
    expect(c.count).toBe(2);
    c.tap(5); // > resetAfter: new run
    expect(c.count).toBe(1);
    expect(c.bpm).toBe(120); // keeps the previous tempo until a new one is tapped
  });

  it("can be seeded with a bpm", () => {
    const c = new TapClock();
    expect(c.phase(1)).toBeNull();
    c.setBpm(90, 0);
    expect(c.bpm).toBe(90);
    expect(c.phase(60 / 90 / 2)).toBeCloseTo(0.5);
    c.reset();
    expect(c.bpm).toBeNull();
  });
});
