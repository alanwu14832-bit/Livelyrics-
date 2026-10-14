import { describe, expect, it } from "vitest";
import type { Lyrics } from "../types";
import { compareTiming, nextTimingChange, TIMING_CHANGE_TITLE, timingChangeDetail, timingChanged, timingSnapshot } from "./timing-change";

const lyrics = (rows: Array<[string, number | null]>): Lyrics => ({ source: "user", synced: true, lines: rows.map(([text, start], i) => ({ id: `l${i}`, text, start, end: null })) });
const AT = "2026-10-14T00:00:00.000Z";

describe("round 19 (M6) · the lyric timing a plan was designed with", () => {
  const estimated = lyrics([
    ["keep on working on your dreams", 0.4],
    ["keep on following your dreams", 4.2],
    ["we searching everywhere", 9],
  ]);

  it("「AI 自動對時」 moving the first line from 0:00 to 0:10 asks for a re-design", () => {
    const aligned = lyrics([
      ["keep on working on your dreams", 10.2],
      ["keep on following your dreams", 19.5],
      ["we searching everywhere", 28.5],
    ]);
    const change = nextTimingChange(undefined, estimated, aligned, AT);
    expect(change).toMatchObject({ lines: 3, shift: 19.5, at: AT });
    expect(change?.baseline).toEqual(timingSnapshot(estimated));
    expect(TIMING_CHANGE_TITLE).toBe("歌詞時間改了，建議重新設計段落與提示");
    expect(timingChangeDetail(change!)).toContain("3 句的時間移動超過 2 秒（最多 19.5 秒）");
  });

  it("small nudges do not, and text edits that insert or remove lines are not timing changes", () => {
    const nudged = lyrics([
      ["keep on working on your dreams", 1.5],
      ["a new line", 3],
      ["keep on following your dreams", 5],
      ["we searching everywhere", 9.4],
    ]);
    expect(compareTiming(timingSnapshot(estimated), nudged)).toEqual({ lines: 0, shift: 0 });
    expect(timingChanged(nextTimingChange(undefined, estimated, nudged, AT))).toBe(false);
  });

  it("measures against the design's timing, so small edits add up across saves", () => {
    const step1 = lyrics([
      ["keep on working on your dreams", 1.9],
      ["keep on following your dreams", 4.2],
      ["we searching everywhere", 9],
    ]);
    // the first save (a plan from before round 19): the lyrics before it are the baseline
    const first = nextTimingChange(undefined, estimated, step1, AT);
    expect(timingChanged(first)).toBe(false);
    const baseline = first;
    const step2 = lyrics([
      ["keep on working on your dreams", 3.4],
      ["keep on following your dreams", 4.2],
      ["we searching everywhere", 9],
    ]);
    // 1.9 → 3.4 is 1.5 s since the last save, but 3 s since the design
    expect(nextTimingChange(baseline, step1, step2, AT)).toMatchObject({ lines: 1, shift: 3 });
  });

  it("a line that gets its first time counts", () => {
    const untimed = lyrics([
      ["a", null],
      ["b", null],
    ]);
    const timed = lyrics([
      ["a", 12],
      ["b", 15],
    ]);
    expect(compareTiming(timingSnapshot(untimed), timed)).toEqual({ lines: 2, shift: 0 });
  });
});
