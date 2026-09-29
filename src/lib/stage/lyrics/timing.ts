// Word/character timing for a lyric line.
// Uses line.words when present (aligned onto the tokenized units), otherwise
// synthesizes timing: per CJK character / per Latin word, weighted by length,
// spread over an estimated "sung" duration inside the line span.

import type { LyricWord } from "../../types";
import type { TextUnit } from "./tokenize";

export interface TimedUnit extends TextUnit {
  /** seconds relative to the line start */
  t0: number;
  /** seconds relative to the line start */
  t1: number;
}

/** Relative singing weight of a unit (≈ syllables). */
export function unitWeight(u: TextUnit): number {
  switch (u.kind) {
    case "cjk":
      return 1;
    case "latin": {
      const letters = [...u.text].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
      return Math.max(0.6, 0.35 + 0.16 * letters);
    }
    case "space":
      return 0.15;
    case "punct":
      return /[，。！？、,.!?；;：:…—]/.test(u.text) ? 0.35 : 0;
  }
}

/** Seconds per unit of weight when nothing else is known (~150 CJK chars/min). */
export const SECONDS_PER_WEIGHT = 0.4;

/**
 * How long the vocal part of a line lasts. With a known span the vocal usually
 * ends before the next line starts (breath / held note), so we stay inside it.
 */
export function estimateSungDuration(units: TextUnit[], span: number | null): number {
  let weight = 0;
  for (const u of units) weight += unitWeight(u);
  const natural = Math.max(0.3, weight * SECONDS_PER_WEIGHT);
  if (span == null || !Number.isFinite(span) || span <= 0) return clamp(natural * 1.1, 1.2, 8);
  return clamp(natural, span * 0.5, span * 0.92);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Spread units across `duration` seconds by weight (leading/trailing spaces get no time). */
export function synthesizeTiming(units: TextUnit[], duration: number): TimedUnit[] {
  const weights = units.map(unitWeight);
  // punctuation / spaces at the very end shouldn't consume sung time
  for (let i = units.length - 1; i >= 0 && (units[i].kind === "space" || units[i].kind === "punct"); i--) weights[i] = 0;
  for (let i = 0; i < units.length && units[i].kind === "space"; i++) weights[i] = 0;
  const total = weights.reduce((a, b) => a + b, 0);
  const d = Math.max(0, duration);
  let acc = 0;
  return units.map((u, i) => {
    const t0 = total > 0 ? (acc / total) * d : 0;
    acc += weights[i];
    const t1 = total > 0 ? (acc / total) * d : 0;
    return { ...u, t0, t1 };
  });
}

/**
 * Align word-level timing onto units. Returns null when the words don't match
 * the line text well enough (caller then synthesizes).
 */
export function timingFromWords(text: string, units: TextUnit[], words: LyricWord[], lineStart: number): TimedUnit[] | null {
  const valid = words.filter((w) => w && typeof w.text === "string" && w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end));
  if (valid.length === 0) return null;

  // locate each word in the text, in order
  const ranges: Array<{ from: number; to: number; start: number; end: number }> = [];
  let cursor = 0;
  let misses = 0;
  for (const w of valid) {
    const needle = w.text.trim();
    const at = text.indexOf(needle, cursor);
    if (at < 0) {
      misses++;
      continue;
    }
    const start = w.start - lineStart;
    const end = Math.max(start, w.end - lineStart);
    ranges.push({ from: at, to: at + needle.length, start, end });
    cursor = at + needle.length;
  }
  if (ranges.length === 0 || misses > valid.length / 2) return null;

  const out: TimedUnit[] = units.map((u) => ({ ...u, t0: NaN, t1: NaN }));
  for (const r of ranges) {
    const covered = out.filter((u) => u.from < r.to && u.to > r.from);
    const weights = covered.map((u) => Math.max(unitWeight(u), 0.05));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    covered.forEach((u, k) => {
      u.t0 = r.start + ((r.end - r.start) * acc) / total;
      acc += weights[k];
      u.t1 = r.start + ((r.end - r.start) * acc) / total;
    });
  }
  // uncovered units (spaces, punctuation, unmatched words) inherit neighbouring time
  let last = 0;
  for (const u of out) {
    if (Number.isNaN(u.t0)) {
      u.t0 = last;
      u.t1 = last;
    } else {
      last = u.t1;
    }
  }
  return out;
}

/** 0..1 progress of a unit at `elapsed` seconds into the line. */
export function unitProgress(u: TimedUnit, elapsed: number): number {
  if (elapsed <= u.t0) return u.t1 <= u.t0 && elapsed >= u.t0 ? 1 : 0;
  if (u.t1 <= u.t0) return 1;
  return clamp((elapsed - u.t0) / (u.t1 - u.t0), 0, 1);
}

/** End of the sung part of a timed unit list (seconds relative to line start). */
export function sungEnd(units: TimedUnit[]): number {
  let end = 0;
  for (const u of units) if (u.t1 > end) end = u.t1;
  return end;
}
