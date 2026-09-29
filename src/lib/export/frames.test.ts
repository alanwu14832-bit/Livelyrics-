import { describe, expect, it } from "vitest";
import { FRAME_RATES, frameAt, frameAtOrAfter, frameCount, frameDurationUs, frameOffset, frameTime, frameTimestampUs, parseTimeInput, timecode } from "./frames";

const r2997 = FRAME_RATES["29.97"];
const r30 = FRAME_RATES["30"];
const r25 = FRAME_RATES["25"];

describe("frame timing", () => {
  it("counts frames that start before the end", () => {
    expect(frameCount(10, r30)).toBe(300);
    expect(frameCount(10.001, r30)).toBe(301);
    expect(frameCount(10, r25)).toBe(250);
    expect(frameCount(0, r30)).toBe(0);
    expect(frameCount(0.001, r30)).toBe(1);
    // 29.97: 10 s = 299.7 frames -> 300 frames
    expect(frameCount(10, r2997)).toBe(300);
    // exactly 1001 s = 30000 frames at 29.97, not 30001 from float noise
    expect(frameCount(1001, r2997)).toBe(30000);
  });

  it("uses the exact rational for 29.97", () => {
    expect(frameOffset(30000, r2997)).toBe(1001);
    expect(frameOffset(1, r2997)).toBeCloseTo(1001 / 30000, 15);
    expect(frameTime(12, 3, r30)).toBeCloseTo(12.1, 12);
  });

  it("microsecond timestamps never drift and durations tile exactly", () => {
    let sum = 0;
    for (let i = 0; i < 30000; i++) sum += frameDurationUs(i, r2997);
    expect(sum).toBe(frameTimestampUs(30000, r2997));
    expect(frameTimestampUs(30000, r2997)).toBe(1_001_000_000);
    // 33366 or 33367 us per frame
    const d = new Set(Array.from({ length: 100 }, (_, i) => frameDurationUs(i, r2997)));
    expect([...d].every((x) => x === 33366 || x === 33367)).toBe(true);
  });

  it("maps times back to frames without float off-by-one", () => {
    for (let i = 0; i < 2000; i++) {
      expect(frameAt(frameOffset(i, r2997), r2997)).toBe(i);
      expect(frameAtOrAfter(frameOffset(i, r2997), r2997)).toBe(i);
    }
    expect(frameAt(0.0334, r2997)).toBe(1);
    expect(frameAtOrAfter(0.02, r30)).toBe(1);
  });
});

describe("timecode", () => {
  it("non-drop for integer rates", () => {
    expect(timecode(0, r30)).toBe("00:00:00:00");
    expect(timecode(29, r30)).toBe("00:00:00:29");
    expect(timecode(30 * 61 + 5, r30)).toBe("00:01:01:05");
    expect(timecode(25 * 3600, r25)).toBe("01:00:00:00");
  });

  it("drop-frame for 29.97", () => {
    expect(timecode(1799, r2997)).toBe("00:00:59;29");
    expect(timecode(1800, r2997)).toBe("00:01:00;02");
    expect(timecode(17982, r2997)).toBe("00:10:00;00");
    expect(timecode(17981, r2997)).toBe("00:09:59;29");
    // one hour of 29.97 = 107892 frames
    expect(timecode(107892, r2997)).toBe("01:00:00;00");
  });
});

describe("parseTimeInput", () => {
  it("reads seconds and m:ss", () => {
    expect(parseTimeInput("83.5")).toBe(83.5);
    expect(parseTimeInput("1:23.5")).toBe(83.5);
    expect(parseTimeInput("0:07")).toBe(7);
    expect(parseTimeInput("1：02")).toBe(62);
    expect(parseTimeInput("1:75")).toBeNull();
    expect(parseTimeInput("abc")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
  });
});
