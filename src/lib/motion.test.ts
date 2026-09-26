import { describe, expect, it } from "vitest";
import { createVelocityTracker, motionFor, projectMomentum, rubberband, rubberbandClamp, scrollBehavior, shouldDismiss, spring, fadeReduced, staggerDelay } from "./motion";

describe("projectMomentum", () => {
  it("matches Apple's projection", () => {
    // 1000 px/s at 0.998 travels 499 px
    expect(projectMomentum(1000)).toBeCloseTo(499, 5);
    expect(projectMomentum(-500, 0.99)).toBeCloseTo(-49.5, 5);
    expect(projectMomentum(0)).toBe(0);
    expect(projectMomentum(NaN)).toBe(0);
    expect(projectMomentum(1000, 1)).toBe(0);
  });
});

describe("rubberband", () => {
  it("resists progressively and keeps the sign", () => {
    const a = rubberband(50, 300);
    const b = rubberband(100, 300);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(50);
    expect(b - a).toBeLessThan(a); // diminishing returns
    expect(rubberband(-50, 300)).toBeCloseTo(-a, 10);
    expect(rubberband(10, 0)).toBe(0);
  });

  it("clamps with resistance outside the range only", () => {
    expect(rubberbandClamp(5, 0, 10, 100)).toBe(5);
    const over = rubberbandClamp(20, 0, 10, 100);
    expect(over).toBeGreaterThan(10);
    expect(over).toBeLessThan(20);
    const under = rubberbandClamp(-10, 0, 10, 100);
    expect(under).toBeLessThan(0);
    expect(under).toBeGreaterThan(-10);
  });
});

describe("createVelocityTracker", () => {
  it("measures px/s over the recent window", () => {
    const v = createVelocityTracker(100);
    for (let t = 0; t <= 200; t += 10) v.add(t, t * 2); // 2 px/ms
    expect(v.velocity()).toBeCloseTo(2000, 5);
    expect(v.velocity(400)).toBe(0); // rested
    v.reset();
    expect(v.velocity()).toBe(0);
  });
});

describe("shouldDismiss", () => {
  it("flick dismisses before halfway, slow drag returns", () => {
    expect(shouldDismiss(80, 900, 600)).toBe(true);
    expect(shouldDismiss(120, 50, 600)).toBe(false);
    expect(shouldDismiss(320, 0, 600)).toBe(true);
    expect(shouldDismiss(400, -900, 600)).toBe(false);
    expect(shouldDismiss(0, 0, 600)).toBe(false);
  });
});

describe("presets", () => {
  it("falls back to a short fade and instant keyboard scrolling", () => {
    expect(motionFor(true, spring)).toBe(fadeReduced);
    expect(motionFor(false, spring)).toBe(spring);
    expect(scrollBehavior(false, "keyboard")).toBe("auto");
    expect(scrollBehavior(true, "follow")).toBe("auto");
    expect(scrollBehavior(false, "follow")).toBe("smooth");
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(50)).toBeCloseTo(0.44, 10);
  });
});
