// Pure time-lookup helpers shared by the console and the stage renderer.

import type { AudioAnalysis, DesignPlan, LyricLine, Lyrics, SectionDesign } from "./types";

/** Effective [start, end) of a line in seconds, or null when untimed. */
export function lineSpan(lines: LyricLine[], index: number, songDuration: number): [number, number] | null {
  const line = lines[index];
  if (!line || line.start == null) return null;
  let end = line.end;
  if (end == null || end <= line.start) {
    const next = lines.slice(index + 1).find((l) => l.start != null);
    end = next?.start ?? Math.min(line.start + 6, songDuration || line.start + 6);
    // a line should not linger forever over a long instrumental gap
    end = Math.min(end, line.start + 10);
  }
  return [line.start, Math.max(end, line.start + 0.2)];
}

/**
 * Index of the line active at time t (track mode). Returns the last line whose
 * start <= t while t is still inside its span; null during gaps / before the first line.
 */
export function lineIndexAt(lyrics: Lyrics, t: number, songDuration: number): number | null {
  const { lines } = lyrics;
  let candidate: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].start;
    if (s == null) continue;
    if (s <= t) candidate = i;
    else break;
  }
  if (candidate == null) return null;
  const span = lineSpan(lines, candidate, songDuration);
  if (!span) return null;
  return t < span[1] ? candidate : null;
}

/** Index of the next timed line strictly after time t, or null. */
export function nextLineIndexAfter(lyrics: Lyrics, t: number): number | null {
  const { lines } = lyrics;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].start;
    if (s != null && s > t) return i;
  }
  return null;
}

/** 0..1 progress through the line at time t (clamped). */
export function lineProgress(lines: LyricLine[], index: number, t: number, songDuration: number): number {
  const span = lineSpan(lines, index, songDuration);
  if (!span) return 0;
  const [s, e] = span;
  return Math.min(1, Math.max(0, (t - s) / (e - s)));
}

/** Index of the plan section active at time t. Never null when the plan has sections. */
export function sectionIndexAt(plan: DesignPlan | null, t: number): number | null {
  if (!plan || plan.sections.length === 0) return null;
  const secs = plan.sections;
  for (let i = secs.length - 1; i >= 0; i--) {
    if (t >= secs[i].start) return i;
  }
  return 0;
}

/**
 * A line starting at most this long before a section boundary is sung into that section.
 * Section boundaries sit on downbeats (audio analysis snaps them to beats) while singers
 * often come in a beat early, and LRC times can be a few ms before the snapped boundary.
 */
export const LINE_PICKUP_SECONDS = 1.5;

/** The time that decides which section a line belongs to: start + half its span, at most +1.5 s. */
export function lineAnchorTime(start: number, end: number): number {
  return start + Math.min(LINE_PICKUP_SECONDS, Math.max(0, end - start) / 2);
}

/** Anchor time of line `index` (see lineAnchorTime), or null when untimed. */
export function lineAnchor(lines: LyricLine[], index: number, songDuration: number): number | null {
  const span = lineSpan(lines, index, songDuration);
  return span ? lineAnchorTime(span[0], span[1]) : null;
}

/**
 * The plan section a lyric line belongs to (its lyric style, placement and colors come
 * from here, so a pickup line does not switch style half-way when the boundary passes).
 * Null for untimed lines or without a plan.
 */
export function sectionIndexForLine(plan: DesignPlan | null, lines: LyricLine[], index: number, songDuration: number): number | null {
  const anchor = lineAnchor(lines, index, songDuration);
  return anchor == null ? null : sectionIndexAt(plan, anchor);
}

export function sectionAt(plan: DesignPlan | null, t: number): SectionDesign | null {
  const i = sectionIndexAt(plan, t);
  return i == null || !plan ? null : plan.sections[i];
}

/** Linear-interpolated value of an analysis envelope (energy, onset, ...) at time t. */
export function envelopeAt(analysis: AudioAnalysis | null, key: "energy" | "onset" | "brightness" | "bass", t: number): number {
  if (!analysis) return 0;
  const arr = analysis[key];
  if (!arr || arr.length === 0) return 0;
  const x = t * analysis.envelopeRate;
  const i = Math.floor(x);
  if (i < 0) return arr[0];
  if (i >= arr.length - 1) return arr[arr.length - 1];
  const f = x - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

/** 0..1 phase inside the current beat at time t (0 = on the beat). Falls back to bpm grid. */
export function beatPhaseAt(analysis: AudioAnalysis | null, t: number): number {
  if (!analysis) return 0;
  const beats = analysis.beats;
  if (beats && beats.length > 1) {
    // binary search for last beat <= t
    let lo = 0;
    let hi = beats.length - 1;
    if (t < beats[0]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const b0 = beats[lo];
    const b1 = beats[lo + 1] ?? b0 + 60 / Math.max(analysis.bpm, 1);
    return Math.min(1, Math.max(0, (t - b0) / Math.max(1e-3, b1 - b0)));
  }
  if (analysis.bpm > 0) {
    const period = 60 / analysis.bpm;
    return (t % period) / period;
  }
  return 0;
}

/** m:ss.cc — rounded to the nearest hundredth (0.29 → "0:00.29", not "0:00.28"). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  // work in integer hundredths so binary floating point cannot shave off a digit
  const total = Math.round(seconds * 100);
  const m = Math.floor(total / 6000);
  const s = Math.floor(total / 100) % 60;
  const cs = total % 100;
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** m:ss — truncated to whole seconds (a clock never shows a second before it has passed). */
export function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  // tolerate float noise just below a whole second (e.g. 2.9999999 from 0.1 steps)
  const whole = Math.floor(seconds + 1e-6);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
