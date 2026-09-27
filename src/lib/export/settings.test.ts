import { describe, expect, it } from "vitest";
import { FRAME_RATES } from "./frames";
import { avcCandidates, avcLevelsFor, clampRange, exportBaseName, macroblocks, rangeFor, slugify, targetBitrate, variantFileName, vp9Candidate } from "./settings";
import { section, testPlan } from "../console/test-fixtures";
import type { Project } from "../types";

describe("H.264 levels", () => {
  const first = (w: number, h: number, fps: number) => avcLevelsFor(w, h, fps, targetBitrate(w, h, fps, "high", "avc"))[0]?.name;
  it("picks the level from frame size and macroblock rate", () => {
    expect(macroblocks(1920, 1080)).toBe(120 * 68);
    expect(first(1280, 720, 30)).toBe("3.1");
    expect(first(1920, 1080, 30)).toBe("4.0");
    expect(first(1920, 1080, 60)).toBe("4.2");
    expect(first(3840, 2160, 30)).toBe("5.1");
    expect(first(3840, 2160, 60)).toBe("5.2");
    expect(first(3840, 1080, 30)).toBe("5.0");
  });

  it("builds avc1 strings and falls back to higher levels and Main", () => {
    const c = avcCandidates(3840, 2160, 60, 80e6);
    expect(c[0]).toMatchObject({ codecString: "avc1.640034", label: "H.264 High 5.2" });
    expect(c.some((x) => x.codecString.startsWith("avc1.4d00"))).toBe(true);
    expect(avcCandidates(1920, 1080, 30, 10e6)[0].codecString).toBe("avc1.640028");
    // a 16384 x 2160 wall needs level 6; a 16384 x 4096 one does not fit H.264 at all
    expect(avcCandidates(16384, 2160, 30, 100e6)[0].label).toBe("H.264 High 6.0");
    expect(avcCandidates(16384, 4096, 30, 100e6)).toEqual([]);
  });

  it("picks a VP9 level", () => {
    expect(vp9Candidate(1280, 720, 30).codecString).toBe("vp09.00.31.08");
    expect(vp9Candidate(3840, 2160, 60).codecString).toBe("vp09.00.51.08");
  });
});

describe("bitrate", () => {
  it("scales with pixels and fps, VP9 lower", () => {
    const b = targetBitrate(1920, 1080, 30, "high", "avc");
    expect(b).toBeGreaterThan(8e6);
    expect(b).toBeLessThan(12e6);
    expect(targetBitrate(1920, 1080, 60, "high", "avc")).toBeGreaterThan(b);
    expect(targetBitrate(1920, 1080, 30, "high", "vp9")).toBeLessThan(b);
    expect(targetBitrate(64, 64, 25, "standard", "avc")).toBe(2e6);
  });
});

describe("range and names", () => {
  const project = { meta: { duration: 40 }, analysis: null, plan: testPlan([section("s0", 0, 8), section("s1", 8, 24), section("s2", 24, 40)]) } as unknown as Project;
  it("section ranges", () => {
    expect(rangeFor(project, null, null)).toEqual({ start: 0, end: 40 });
    expect(rangeFor(project, 1, 1)).toEqual({ start: 8, end: 24 });
    expect(rangeFor(project, 2, 1)).toEqual({ start: 8, end: 40 });
    expect(clampRange({ start: -3, end: 99 }, 40)).toEqual({ start: 0, end: 40 });
  });
  it("file names are safe and describe the clip", () => {
    expect(slugify('夜/城:市 "Live"*')).toBe("夜_城_市_Live");
    const base = exportBaseName("示範之歌", 1920, 1080, FRAME_RATES["29.97"], { start: 8, end: 24.5 }, 40);
    expect(base).toBe("示範之歌_1920x1080_2997_8-25s");
    expect(variantFileName(base, "lyrics", "matte", "mp4")).toBe("示範之歌_1920x1080_2997_8-25s_lyrics-matte.mp4");
    expect(variantFileName("x", "background", "matte", "webm")).toBe("x_bg.webm");
  });
});
