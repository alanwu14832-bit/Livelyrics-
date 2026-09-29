import { describe, expect, it } from "vitest";
import {
  TimecodeStringSchema,
  coerceTcString,
  formatTc,
  framesToTc,
  hourTc,
  normalizeTcInput,
  parseTc,
  secondsToTc,
  tcToFrames,
  tcToSeconds,
  type FrameRate,
} from "./timecode";

const tc = (hours: number, minutes: number, seconds: number, frames: number) => ({ hours, minutes, seconds, frames });

describe("timecode maths", () => {
  it("counts frames at 24 / 25 / 30 and back", () => {
    for (const rate of [24, 25, 30] as FrameRate[]) {
      expect(tcToFrames(tc(1, 0, 0, 0), rate)).toBe(3600 * rate);
      expect(tcToSeconds(tc(1, 0, 10, 0), rate)).toBeCloseTo(3610, 9);
      for (const n of [0, 1, rate - 1, rate, 3600 * rate + 17, 86399 * rate]) expect(tcToFrames(framesToTc(n, rate), rate)).toBe(n);
    }
  });

  it("drop-frame skips ;00 and ;01 except every tenth minute", () => {
    const rate: FrameRate = 29.97;
    // 01:00:59;29 → 01:01:00;02 (00 and 01 do not exist)
    const before = tcToFrames(tc(1, 0, 59, 29), rate);
    expect(framesToTc(before + 1, rate)).toEqual(tc(1, 1, 0, 2));
    // the tenth minute keeps ;00
    expect(framesToTc(tcToFrames(tc(1, 9, 59, 29), rate) + 1, rate)).toEqual(tc(1, 10, 0, 0));
    // an hour of drop-frame labels is 107892 frames = 3599.9964 real seconds
    expect(tcToFrames(tc(1, 0, 0, 0), rate)).toBe(107892);
    expect(tcToSeconds(tc(1, 0, 0, 0), rate)).toBeCloseTo(3599.9964, 3);
    for (let n = 0; n < 40000; n += 7) expect(tcToFrames(framesToTc(n, rate), rate)).toBe(n);
    // ten labelled seconds after 01:00:00;00 are 10.01 real seconds
    expect(tcToSeconds(tc(1, 0, 10, 0), rate) - tcToSeconds(tc(1, 0, 0, 0), rate)).toBeCloseTo(10.01, 3);
    expect(formatTc(tc(1, 0, 10, 0), rate)).toBe("01:00:10;00");
  });

  it("maps real seconds to the label on screen", () => {
    expect(secondsToTc(3610.5, 25)).toEqual(tc(1, 0, 10, 12));
    expect(formatTc(secondsToTc(3600 + 59.999, 30))).toBe("01:00:59:29");
  });

  it("parses what the operator types", () => {
    expect(parseTc("01:00:10:00")).toEqual(tc(1, 0, 10, 0));
    expect(parseTc("1:00:10;12")).toEqual(tc(1, 0, 10, 12));
    expect(parseTc("01.00.10.00")).toEqual(tc(1, 0, 10, 0));
    expect(parseTc("２")).toBeNull();
    expect(parseTc("3")).toEqual(tc(3, 0, 0, 0));
    expect(parseTc("02：30")).toEqual(tc(2, 30, 0, 0));
    expect(parseTc("24:00:00:00")).toBeNull();
    expect(parseTc("01:60:00:00")).toBeNull();
    expect(parseTc("01:00:00:30")).toBeNull();
    expect(parseTc("abc")).toBeNull();
    expect(normalizeTcInput("3")).toBe("03:00:00:00");
    expect(normalizeTcInput(" 1:2:3:4 ")).toBe("01:02:03:04");
    expect(hourTc(2)).toBe("02:00:00:00");
    expect(hourTc(24)).toBeNull();
  });

  it("validates stored start timecodes (zod and tolerant coercion)", () => {
    expect(TimecodeStringSchema.safeParse("01:00:00:00").success).toBe(true);
    expect(TimecodeStringSchema.safeParse("23:59:59;29").success).toBe(true);
    for (const bad of ["1:00:00:00", "24:00:00:00", "01:00:00:30", "01:00:00", "", "01:00:00:00x"]) expect(TimecodeStringSchema.safeParse(bad).success).toBe(false);
    expect(coerceTcString("02:00:00;00")).toBe("02:00:00:00");
    expect(coerceTcString("nope")).toBeNull();
    expect(coerceTcString(5)).toBeNull();
  });
});
