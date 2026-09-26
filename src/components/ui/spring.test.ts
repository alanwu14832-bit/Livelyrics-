import { describe, expect, it } from "vitest";
import { cubicBezier, easeOutCurve, springState } from "./spring";

describe("springState", () => {
  it("starts at the release point with the release velocity", () => {
    const s = springState(0, 120, -300);
    expect(s.x).toBeCloseTo(120);
    expect(s.v).toBeCloseTo(-300);
  });
  it("critically damped: settles without overshoot (response 0.35 s)", () => {
    let prev = Infinity;
    for (let t = 0; t <= 1; t += 0.01) {
      const { x } = springState(t, 100, 0);
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(prev + 1e-9);
      prev = x;
    }
    expect(springState(0.2, 100, 0).x).toBeLessThan(40); // most of the way in 200 ms
    expect(Math.abs(springState(0.6, 100, 0).x)).toBeLessThan(1);
  });
  it("carries the release velocity (a flick away overshoots the start first)", () => {
    const early = springState(0.03, 0, 1000).x;
    expect(early).toBeGreaterThan(10);
  });
  it("under-damped springs overshoot", () => {
    const xs = Array.from({ length: 100 }, (_, i) => springState(i * 0.01, 100, 0, 0.4, 0.6).x);
    expect(Math.min(...xs)).toBeLessThan(-1);
  });
  it("velocity is the derivative of position", () => {
    for (const [x0, v0, z] of [
      [80, 0, 1],
      [80, -500, 1],
      [80, 200, 0.7],
    ]) {
      const t = 0.07;
      const h = 1e-5;
      const num = (springState(t + h, x0, v0, 0.35, z).x - springState(t - h, x0, v0, 0.35, z).x) / (2 * h);
      expect(springState(t, x0, v0, 0.35, z).v).toBeCloseTo(num, 3);
    }
  });
});

describe("cubicBezier", () => {
  it("hits the endpoints and is monotonic for the ease-out token", () => {
    expect(easeOutCurve(0)).toBe(0);
    expect(easeOutCurve(1)).toBe(1);
    let prev = 0;
    for (let p = 0.05; p < 1; p += 0.05) {
      const y = easeOutCurve(p);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(easeOutCurve(0.25)).toBeGreaterThan(0.6); // strong ease-out: most of the move early
  });
  it("linear control points are the identity", () => {
    const lin = cubicBezier(0, 0, 1, 1);
    for (const p of [0.1, 0.33, 0.5, 0.9]) expect(lin(p)).toBeCloseTo(p, 5);
  });
});
