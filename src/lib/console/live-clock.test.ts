import { describe, expect, it } from "vitest";
import { LiveClock } from "./live-clock";

describe("LiveClock", () => {
  it("stays put until started", () => {
    const c = new LiveClock();
    c.jump(10, 14, 0);
    expect(c.time(5000)).toBe(10);
    expect(c.isRunning).toBe(false);
  });

  it("runs at 1x from the cue and holds at the hold point", () => {
    const c = new LiveClock();
    c.jump(10, 14, 1000);
    c.start(1000);
    expect(c.time(2000)).toBeCloseTo(11);
    expect(c.isHeld(2000)).toBe(false);
    expect(c.time(9000)).toBe(14);
    expect(c.isHeld(9000)).toBe(true);
  });

  it("runs to the song end when there is no hold", () => {
    const c = new LiveClock();
    c.setLimit(20);
    c.jump(15, null, 0);
    c.start(0);
    expect(c.time(3000)).toBeCloseTo(18);
    expect(c.time(60_000)).toBe(20);
  });

  it("stop freezes the current time and start resumes from it", () => {
    const c = new LiveClock();
    c.jump(0, null, 0);
    c.start(0);
    c.stop(2000);
    expect(c.time(10_000)).toBeCloseTo(2);
    c.start(10_000);
    expect(c.time(11_000)).toBeCloseTo(3);
  });

  it("a jump while running keeps running from the new time", () => {
    const c = new LiveClock();
    c.jump(0, null, 0);
    c.start(0);
    c.jump(30, 32, 5000);
    expect(c.time(6000)).toBeCloseTo(31);
    expect(c.time(9000)).toBe(32);
    expect(c.holdAt).toBe(32);
  });

  it("a hold at or before the cue parks the clock at the cue", () => {
    const c = new LiveClock();
    c.jump(10, 8, 0);
    c.start(0);
    expect(c.time(4000)).toBe(10);
  });

  it("sanitizes invalid times", () => {
    const c = new LiveClock();
    c.jump(Number.NaN, null, 0);
    expect(c.time(0)).toBe(0);
    c.jump(-5, null, 0);
    expect(c.time(0)).toBe(0);
  });
});

describe("LiveClock.capHold (LIVE loop)", () => {
  it("parks at the cap instead of running into the next section", () => {
    const c = new LiveClock();
    c.jump(20, null, 0);
    c.start(0);
    c.capHold(24);
    expect(c.time(2000)).toBeCloseTo(22);
    expect(c.time(10000)).toBeCloseTo(24);
    expect(c.isHeld(10000)).toBe(true);
    // an earlier hold point stays
    c.jump(20, 22, 10000);
    c.capHold(24);
    expect(c.holdAt).toBe(22);
  });

  it("brings a clock that already ran past the cap back to it", () => {
    const c = new LiveClock();
    c.jump(20, null, 0);
    c.start(0);
    expect(c.time(8000)).toBeCloseTo(28);
    c.capHold(24);
    expect(c.time(8000)).toBeCloseTo(24);
  });
});
