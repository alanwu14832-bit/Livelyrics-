import { describe, expect, it } from "vitest";
import { beatPhaseAt, formatTime, formatTimeShort, lineAnchor, lineIndexAt, lineSpan, sectionIndexAt, sectionIndexForLine } from "./timeline";
import type { DesignPlan, LyricLine, Lyrics } from "./types";

const line = (id: string, start: number | null, end: number | null = null): LyricLine => ({ id, text: id, start, end });

describe("formatTime", () => {
  it("rounds to hundredths instead of truncating float noise", () => {
    expect(formatTime(0.29)).toBe("0:00.29");
    expect(formatTime(1.15)).toBe("0:01.15");
    expect(formatTime(8.07)).toBe("0:08.07");
    expect(formatTime(64.1)).toBe("1:04.10");
  });

  it("carries into seconds and minutes when rounding up", () => {
    expect(formatTime(59.999)).toBe("1:00.00");
    expect(formatTime(0.996)).toBe("0:01.00");
  });

  it("clamps invalid input to zero", () => {
    expect(formatTime(-3)).toBe("0:00.00");
    expect(formatTime(Number.NaN)).toBe("0:00.00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00.00");
  });
});

describe("formatTimeShort", () => {
  it("truncates to whole seconds", () => {
    expect(formatTimeShort(0)).toBe("0:00");
    expect(formatTimeShort(59.9)).toBe("0:59");
    expect(formatTimeShort(73.2)).toBe("1:13");
  });

  it("is not fooled by float noise just below a second", () => {
    let t = 0;
    for (let i = 0; i < 30; i++) t += 0.1;
    expect(formatTimeShort(t)).toBe("0:03");
  });
});

describe("lineSpan / lineIndexAt", () => {
  const lyrics: Lyrics = {
    source: "user",
    synced: false,
    lines: [line("l0", 8), line("l1", 12, 14), line("l2", null), line("l3", 40)],
  };

  it("derives the end from the next timed line, capped at +10 s", () => {
    expect(lineSpan(lyrics.lines, 0, 73)).toEqual([8, 12]);
    expect(lineSpan(lyrics.lines, 1, 73)).toEqual([12, 14]);
    expect(lineSpan(lyrics.lines, 2, 73)).toBeNull();
    expect(lineSpan(lyrics.lines, 3, 73)).toEqual([40, 46]);
  });

  it("finds the active line and gaps", () => {
    expect(lineIndexAt(lyrics, 5, 73)).toBeNull();
    expect(lineIndexAt(lyrics, 9, 73)).toBe(0);
    expect(lineIndexAt(lyrics, 13, 73)).toBe(1);
    expect(lineIndexAt(lyrics, 20, 73)).toBeNull();
    expect(lineIndexAt(lyrics, 41, 73)).toBe(3);
  });
});

describe("sectionIndexAt / beatPhaseAt", () => {
  it("returns null without a plan", () => {
    expect(sectionIndexAt(null, 3)).toBeNull();
  });

  it("falls back to the bpm grid when beats are missing", () => {
    const analysis = {
      duration: 10,
      sampleRate: 22050,
      bpm: 120,
      bpmConfidence: 1,
      beats: [],
      envelopeRate: 20,
      energy: [],
      onset: [],
      brightness: [],
      bass: [],
      peaks: [],
      sections: [],
    };
    expect(beatPhaseAt(analysis, 1.25)).toBeCloseTo(0.5);
    expect(beatPhaseAt(null, 1)).toBe(0);
  });
});

describe("sectionIndexForLine", () => {
  const plan = { sections: [{ start: 0 }, { start: 8.001 }, { start: 24.003 }, { start: 40.008 }] } as unknown as DesignPlan;
  const lines = [line("a", 8), line("b", 12), line("c", 20), line("d", 23.4), line("e", 28), line("f", 39.9, 40.1), line("g", null)];

  it("puts a line that starts a hair or a beat before a boundary into the section it is sung in", () => {
    expect(sectionIndexForLine(plan, lines, 0, 73)).toBe(1); // 8.000 vs boundary 8.001
    expect(sectionIndexForLine(plan, lines, 3, 73)).toBe(2); // pickup 0.6 s before the chorus
  });

  it("keeps ordinary lines and short lines before a boundary where they start", () => {
    expect(sectionIndexForLine(plan, lines, 1, 73)).toBe(1);
    expect(sectionIndexForLine(plan, lines, 2, 73)).toBe(1); // 20–23.4: anchor 21.5
    expect(sectionIndexForLine(plan, lines, 5, 73)).toBe(2); // 39.9–40.1: anchor 40.0
    expect(lineAnchor(lines, 1, 73)).toBeCloseTo(13.5);
  });

  it("is null for untimed lines and without a plan", () => {
    expect(sectionIndexForLine(plan, lines, 6, 73)).toBeNull();
    expect(sectionIndexForLine(null, lines, 0, 73)).toBeNull();
  });
});
