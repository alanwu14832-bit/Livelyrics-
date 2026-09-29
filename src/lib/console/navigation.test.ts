import { describe, expect, it } from "vitest";
import {
  LOOP_LOOKAHEAD,
  effectiveDuration,
  lastStartedLine,
  lineSections,
  linesInSection,
  loopNextLine,
  loopSeekTarget,
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

describe("section membership and loops (段落列 / 循環段落)", () => {
  const plan = testPlan();
  // sections s0 0-8, s1 8-24, s2 24-40; l0 8, l1 12, l2 untimed, l3 16, l4 26
  it("groups lines by section, untimed lines with the timed line before them", () => {
    expect(lineSections(plan, lines, 40)).toEqual([1, 1, 1, 1, 2]);
    expect(linesInSection(plan, lines, 1, 40)).toEqual([0, 1, 2, 3]);
    expect(linesInSection(plan, lines, 2, 40)).toEqual([4]);
    expect(linesInSection(plan, lines, 0, 40)).toEqual([]);
    expect(lineSections(null, lines, 40)).toEqual([null, null, null, null, null]);
  });

  it("LIVE loop wraps only after the section's last line", () => {
    const s1 = linesInSection(plan, lines, 1, 40);
    expect(loopNextLine(s1, 3)).toBe(0); // last line of s1 -> its first
    expect(loopNextLine(s1, 1)).toBeNull(); // mid-section: the normal next line
    expect(loopNextLine(s1, 4)).toBeNull(); // not in the section
    expect(loopNextLine(s1, null)).toBeNull();
    expect(loopNextLine([], 3)).toBeNull();
    expect(loopNextLine([4], 4)).toBe(4); // a one-line section repeats its line
  });

  it("TRACK loop seeks back once playback reaches the section end", () => {
    const s = { start: 24, end: 40 };
    expect(loopSeekTarget(s, 30)).toBeNull();
    expect(loopSeekTarget(s, 39.97)).toBeNull();
    expect(loopSeekTarget(s, 40 - LOOP_LOOKAHEAD)).toBe(24);
    expect(loopSeekTarget(s, 41)).toBe(24);
    expect(loopSeekTarget(s, 39.99, 0.05)).toBe(24);
    // degenerate sections never loop on the spot
    expect(loopSeekTarget({ start: 10, end: 10.01 }, 10.02)).toBeNull();
    expect(loopSeekTarget({ start: 10, end: 10.01 }, 10.2)).toBe(10);
    expect(loopSeekTarget(null, 5)).toBeNull();
    expect(loopSeekTarget({ start: 5, end: Number.NaN }, 5)).toBeNull();
  });
});
