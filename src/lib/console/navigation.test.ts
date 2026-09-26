import { describe, expect, it } from "vitest";
import {
  effectiveDuration,
  lastStartedLine,
  liveHoldTime,
  liveNextLine,
  livePrevLine,
  nextTimedLineAfter,
  sectionOfLine,
  sortedCues,
  timedRatio,
  trackNextLine,
  trackPrevLine,
  untimedCount,
  upcomingCue,
} from "./navigation";
import { testLyrics, testPlan } from "./test-fixtures";

const lyrics = testLyrics();
const lines = lyrics.lines;

describe("track navigation", () => {
  it("next line is the first timed line after t (skipping untimed)", () => {
    expect(trackNextLine(lyrics, 0)).toBe(0);
    expect(trackNextLine(lyrics, 8)).toBe(1); // exactly on l0's start -> l1
    expect(trackNextLine(lyrics, 12.5)).toBe(3); // l2 is untimed
    expect(trackNextLine(lyrics, 26)).toBeNull();
  });

  it("previous line goes to the line before the active one", () => {
    expect(trackPrevLine(lyrics, 12.5, 60)).toBe(0);
    expect(trackPrevLine(lyrics, 16.2, 60)).toBe(1); // skips untimed l2
    expect(trackPrevLine(lyrics, 9, 60)).toBeNull();
  });

  it("previous line during a gap replays the most recent line", () => {
    // l3 ends at 20, l4 starts at 26 -> 22 is a gap
    expect(trackPrevLine(lyrics, 22, 60)).toBe(3);
    expect(trackPrevLine(lyrics, 2, 60)).toBeNull();
  });

  it("lastStartedLine / nextTimedLineAfter", () => {
    expect(lastStartedLine(lines, 7.9)).toBeNull();
    expect(lastStartedLine(lines, 8)).toBe(0);
    expect(lastStartedLine(lines, 100)).toBe(4);
    expect(nextTimedLineAfter(lines, 16)).toBe(4);
  });
});

describe("live navigation", () => {
  it("holds at the next timed line's start", () => {
    expect(liveHoldTime(lines, 0, 8)).toBe(12);
    expect(liveHoldTime(lines, 1, 12)).toBe(16); // untimed l2 skipped
    expect(liveHoldTime(lines, 2, 13)).toBe(16);
    expect(liveHoldTime(lines, 4, 26)).toBeNull();
  });

  it("next/prev relative to the current or last cued line", () => {
    expect(liveNextLine(lines, 1, null, 0)).toBe(2);
    expect(liveNextLine(lines, null, 3, 0)).toBe(4);
    expect(liveNextLine(lines, 4, null, 0)).toBeNull();
    expect(livePrevLine(lines, 2, null)).toBe(1);
    expect(livePrevLine(lines, 0, null)).toBe(0);
    expect(livePrevLine(lines, null, null)).toBeNull();
  });

  it("first cue picks the first line at or after the virtual time", () => {
    expect(liveNextLine(lines, null, null, 0)).toBe(0);
    expect(liveNextLine(lines, null, null, 13)).toBe(2); // untimed lines are always eligible
    expect(liveNextLine([], null, null, 0)).toBeNull();
  });
});

describe("sections and cues", () => {
  const plan = testPlan();
  it("maps a line to the section it is sung in", () => {
    expect(sectionOfLine(plan, lines, 0, 73)).toBe(1);
    expect(sectionOfLine(plan, lines, 4, 73)).toBe(2);
    expect(sectionOfLine(plan, lines, 2, 73)).toBeNull();
    expect(sectionOfLine(null, lines, 0, 73)).toBeNull();
  });

  it("sorts cues and finds the upcoming one", () => {
    const cues = sortedCues(plan);
    expect(cues.map((c) => c.time)).toEqual([8, 24]);
    expect(upcomingCue(cues, 0)?.index).toBe(0);
    expect(upcomingCue(cues, 0)?.inSeconds).toBe(8);
    expect(upcomingCue(cues, 9)?.index).toBe(0); // still "now" within the active window
    expect(upcomingCue(cues, 11)?.index).toBe(1);
    expect(upcomingCue(cues, 30)).toBeNull();
  });
});

describe("lyrics stats and duration", () => {
  it("counts untimed lines", () => {
    expect(untimedCount(lyrics)).toBe(1);
    expect(timedRatio(lyrics)).toBeCloseTo(0.8);
    expect(timedRatio({ source: "none", synced: false, lines: [] })).toBe(0);
  });

  it("prefers audio, then meta, then analysis durations", () => {
    expect(effectiveDuration(70, 60, 50, lyrics)).toBe(70);
    expect(effectiveDuration(NaN, 60, 50, lyrics)).toBe(60);
    expect(effectiveDuration(null, 0, 50, lyrics)).toBe(50);
    expect(effectiveDuration(undefined, undefined, undefined, lyrics)).toBe(30);
    expect(effectiveDuration(undefined, undefined, undefined, null)).toBe(0);
  });
});
