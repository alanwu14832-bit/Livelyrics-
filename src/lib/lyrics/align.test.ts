// Round 14: the phrase aligner and distributeLines with a 人聲 curve — lines land on phrases in
// order, timed lines (taps) are never moved, and a curve that cannot carry a run falls back to
// the proportional spread.

import { describe, expect, it } from "vitest";
import type { AudioAnalysis, Lyrics } from "../types";
import { alignRun, detectPhrases, REAL_GAP_SECONDS, sungSeconds } from "./align";
import { distributeLines, lineWeight, parseLyricsText } from "./lrc";

const RATE = 20;

/** a 0..1 curve at 20 Hz: `hi` inside the phrases (short ramps at the edges), `lo` elsewhere, optional dips */
function curveOf(seconds: number, phrases: Array<[number, number]>, opts: { lo?: number; hi?: number; dips?: number[] } = {}): number[] {
  const { lo = 0.05, hi = 0.9, dips = [] } = opts;
  return Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const t = i / RATE;
    let v = lo;
    for (const [a, b] of phrases) if (t >= a && t < b) v = Math.max(v, lo + (hi - lo) * Math.min(1, (t - a) / 0.1, (b - t) / 0.1));
    for (const d of dips) if (Math.abs(t - d) < 0.1) v = Math.min(v, 0.45);
    return Math.round(v * 10000) / 10000;
  });
}

function analysisWith(duration: number, vocal: number[] | undefined): AudioAnalysis {
  const n = Math.round(duration * RATE);
  return {
    duration,
    sampleRate: 44100,
    bpm: 120,
    bpmConfidence: 0.5,
    beats: [],
    envelopeRate: RATE,
    energy: new Array(n).fill(0.6),
    onset: new Array(n).fill(0.2),
    brightness: new Array(n).fill(0.5),
    bass: new Array(n).fill(0.4),
    ...(vocal ? { vocal } : {}),
    peaks: [],
    sections: [],
  };
}

/** a deterministic 0..1 generator */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("detectPhrases", () => {
  it("finds the phrases of a curve with hysteresis, merges tiny gaps and drops blips", () => {
    const c = curveOf(20, [
      [2, 5],
      [5.15, 7],
      [9, 9.2],
      [12, 16],
    ]);
    const p = detectPhrases(c, RATE);
    // [2,5] and [5.15,7] merge (gap < 0.25 s); the 0.2 s blip is dropped
    expect(p.length).toBe(2);
    // the onset is where the rise began (within a frame of the true start)
    expect(Math.abs(p[0].start - 2)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(p[0].end - 7)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(p[1].start - 12)).toBeLessThanOrEqual(0.06);
    expect(detectPhrases(new Array(400).fill(0.1), RATE)).toEqual([]);
  });

  it("sungSeconds counts the curve inside phrases and a quarter of it outside", () => {
    const c = curveOf(10, [[2, 6]], { lo: 0, hi: 1 });
    expect(sungSeconds(c, RATE)).toBeGreaterThan(3.7);
    expect(sungSeconds(c, RATE)).toBeLessThan(4.1);
    expect(sungSeconds(new Array(200).fill(0.2), RATE)).toBeCloseTo(0.25 * 0.2 * 10, 5);
  });
});

describe("alignRun", () => {
  const PHRASES: Array<[number, number]> = [
    [5, 9],
    [11.5, 15.5],
    [18, 22],
    [26, 30],
  ];

  it("starts each line at its phrase and ends it with the voice when a real gap follows", () => {
    const res = alignRun({ curve: curveOf(36, PHRASES), rate: RATE, from: 0, to: 36, prev: null, hasNext: false, lines: PHRASES.map(() => ({ weight: lineWeight("一二三四五六七八") })) })!;
    expect(res).not.toBeNull();
    res.starts.forEach((s, k) => expect(Math.abs(s - PHRASES[k][0]), `line ${k} at ${s}`).toBeLessThanOrEqual(0.15));
    // 18–22 then silence until 26: the third line clears before the gap
    expect(res.ends[2]).not.toBeNull();
    expect(res.ends[2]!).toBeGreaterThanOrEqual(22);
    expect(res.ends[2]!).toBeLessThanOrEqual(22.5);
    // 5–9 then 11.5: a 2.5 s gap is a real gap too
    expect(11.5 - 9).toBeGreaterThanOrEqual(REAL_GAP_SECONDS);
    expect(res.ends[0]).not.toBeNull();
  });

  it("splits a long phrase at a clear dip when there are more lines than phrases", () => {
    // one 8 s phrase with a dip at 9 s, then another phrase: three lines
    const curve = curveOf(24, [
      [5, 13],
      [16, 20],
    ], { dips: [9] });
    const res = alignRun({ curve, rate: RATE, from: 0, to: 24, prev: null, hasNext: false, lines: [0, 1, 2].map(() => ({ weight: lineWeight("一二三四五六七八") })) })!;
    expect(Math.abs(res.starts[0] - 5)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(res.starts[1] - 9)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(res.starts[2] - 16)).toBeLessThanOrEqual(0.15);
  });

  it("keeps the lines in order and inside the window, whatever the curve", () => {
    const rand = rng(7);
    for (let trial = 0; trial < 40; trial++) {
      const seconds = 30 + Math.floor(rand() * 60);
      const curve = Array.from({ length: seconds * RATE }, () => rand());
      // song times are kept to the millisecond
      const from = Math.round(rand() * 5000) / 1000;
      const to = seconds - Math.round(rand() * 5000) / 1000;
      const k = 1 + Math.floor(rand() * 12);
      const lines = Array.from({ length: k }, () => ({ weight: 1.5 + rand() * 10 }));
      const res = alignRun({ curve, rate: RATE, from, to, prev: rand() < 0.5 ? { weight: 4 } : null, hasNext: rand() < 0.5, lines });
      if (!res) continue;
      expect(res.starts.length).toBe(k);
      for (let i = 0; i < k; i++) {
        expect(res.starts[i]).toBeGreaterThanOrEqual(from);
        expect(res.starts[i]).toBeLessThan(to);
        if (i > 0) expect(res.starts[i]).toBeGreaterThan(res.starts[i - 1]);
        const end = res.ends[i];
        if (end != null) {
          expect(end).toBeGreaterThan(res.starts[i]);
          expect(end).toBeLessThanOrEqual(i + 1 < k ? res.starts[i + 1] : to);
        }
      }
    }
  });

  it("gives up (null) when the curve has no voice in the window", () => {
    expect(alignRun({ curve: new Array(600).fill(0.1), rate: RATE, from: 0, to: 30, prev: null, hasNext: false, lines: [{ weight: 5 }, { weight: 5 }] })).toBeNull();
    // fewer places to start than lines
    expect(alignRun({ curve: curveOf(30, [[10, 11]]), rate: RATE, from: 0, to: 30, prev: null, hasNext: false, lines: Array.from({ length: 8 }, () => ({ weight: 5 })) })).toBeNull();
  });

  it("is fast enough for a long song (60 untimed lines)", () => {
    const phrases: Array<[number, number]> = Array.from({ length: 60 }, (_, k) => [8 + k * 4, 8 + k * 4 + 3] as [number, number]);
    const curve = curveOf(260, phrases);
    const lines = phrases.map((_, k) => ({ weight: lineWeight("一二三四五六七八九十".slice(0, 4 + (k % 6))) }));
    const t0 = performance.now();
    const res = alignRun({ curve, rate: RATE, from: 0, to: 260, prev: null, hasNext: false, lines })!;
    const ms = performance.now() - t0;
    expect(res).not.toBeNull();
    expect(ms).toBeLessThan(3000);
    // every line on its own phrase
    const onset = res.starts.filter((s, k) => Math.abs(s - phrases[k][0]) <= 0.15).length;
    expect(onset).toBeGreaterThanOrEqual(55);
  });
});

describe("distributeLines with a 人聲 curve", () => {
  const TEXT = ["第一句歌詞在這裡", "第二句歌詞在這裡", "第三句歌詞在這裡", "第四句歌詞在這裡", "第五句歌詞在這裡", "第六句歌詞在這裡"].join("\n");
  const PHRASES: Array<[number, number]> = [
    [10, 13],
    [15, 18],
    [20, 23],
    [30, 33],
    [35, 38],
    [40, 43],
  ];
  const DURATION = 60;

  it("lays untimed lines over the phrases", () => {
    const out = distributeLines(parseLyricsText(TEXT, "user"), analysisWith(DURATION, curveOf(DURATION, PHRASES)), DURATION);
    expect(out.timing).toBe("estimated");
    out.lines.forEach((l, k) => expect(Math.abs((l.start as number) - PHRASES[k][0]), `line ${k} at ${l.start}`).toBeLessThanOrEqual(0.15));
    // a 7 s break after the third line: its words clear with the voice
    expect(out.lines[2].end).not.toBeNull();
    expect(out.lines[2].end!).toBeLessThanOrEqual(23.5);
  });

  it("never moves a timed line (a tap) and keeps the order around it", () => {
    const base = parseLyricsText(TEXT, "user");
    // the operator tapped lines 1 and 4 (a little off the curve's phrases, on purpose)
    const lines = base.lines.map((l, k) => (k === 1 ? { ...l, start: 15.3 } : k === 4 ? { ...l, start: 35.2 } : l));
    const out = distributeLines({ ...base, lines }, analysisWith(DURATION, curveOf(DURATION, PHRASES)), DURATION);
    expect(out.lines[1].start).toBe(15.3);
    expect(out.lines[4].start).toBe(35.2);
    const starts = out.lines.map((l) => l.start as number);
    for (let k = 1; k < starts.length; k++) expect(starts[k]).toBeGreaterThan(starts[k - 1]);
    // the untimed lines between the taps still find their phrases
    expect(Math.abs(starts[2] - 20)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(starts[3] - 30)).toBeLessThanOrEqual(0.15);
  });

  it("falls back to the proportional spread without a usable curve", () => {
    const lyrics = parseLyricsText(TEXT, "user");
    const plain = distributeLines(lyrics, analysisWith(DURATION, undefined), DURATION);
    // a curve with no voice at all cannot carry the run: the same spread
    const silent = distributeLines(lyrics, analysisWith(DURATION, new Array(DURATION * RATE).fill(0.05)), DURATION);
    expect(silent.lines.map((l) => [l.start, l.end])).toEqual(plain.lines.map((l) => [l.start, l.end]));
    // a curve too short for the song is ignored
    const short = distributeLines(lyrics, analysisWith(DURATION, curveOf(5, [[1, 3]])), DURATION);
    expect(short.lines.map((l) => [l.start, l.end])).toEqual(plain.lines.map((l) => [l.start, l.end]));
    // no analysis at all: still a spread over the song, marked estimated
    const none = distributeLines(lyrics, null, DURATION);
    expect(none.timing).toBe("estimated");
    expect(none.lines.every((l) => l.start != null)).toBe(true);
  });

  it("a timed song is left alone", () => {
    const lrc = parseLyricsText("[00:10.00]一\n[00:15.00]二", "user") as Lyrics;
    const out = distributeLines(lrc, analysisWith(30, curveOf(30, [[2, 4]])), 30);
    expect(out.lines.map((l) => l.start)).toEqual([10, 15]);
    expect(out.timing).toBeUndefined();
  });
});
