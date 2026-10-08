// Lyric-timing evaluation (round 14): the metrics and dataset helpers of the local measurement
// harness (`timing-eval.test.ts`, skipped unless LIVELYRICS_TIMING_EVAL_DIR is set). Pure: the
// harness reads the files, this module only parses text and scores estimated lyrics against
// human-annotated line times (JamendoLyrics MultiLang format: `start_time,end_time,lyrics_line`).

import { lineIndexAt } from "../timeline";
import type { Lyrics } from "../types";

export interface AnnotatedLine {
  start: number;
  end: number;
  text: string;
}

/** `start_time,end_time,lyrics_line` rows (header optional; the text may contain commas). */
export function parseLineAnnotations(csv: string): AnnotatedLine[] {
  const out: AnnotatedLine[] = [];
  for (const raw of csv.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue; // the header
    out.push({ start, end: Math.max(start, end), text: parts.slice(2).join(",").trim() });
  }
  return out;
}

/**
 * The non-empty lines of a lyrics text and the index of the first line of every paragraph (blank
 * lines separate paragraphs). A file that leaves a blank line after almost every line separates
 * its paragraphs with two or more blank lines instead.
 */
export function lyricParagraphs(text: string): { lines: string[]; paragraphStarts: number[] } {
  const raw = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const lines: string[] = [];
  /** blank lines seen right before each non-empty line */
  const blanksBefore: number[] = [];
  let blanks = 0;
  for (const r of raw) {
    if (!r.trim()) {
      blanks++;
      continue;
    }
    lines.push(r.trim());
    blanksBefore.push(lines.length === 1 ? Infinity : blanks);
    blanks = 0;
  }
  if (lines.length === 0) return { lines, paragraphStarts: [] };
  const single = blanksBefore.slice(1).filter((b) => b >= 1).length;
  const minBlanks = lines.length > 4 && single >= 0.7 * (lines.length - 1) ? 2 : 1;
  const paragraphStarts = blanksBefore.flatMap((b, i) => (b >= minBlanks ? [i] : []));
  return { lines, paragraphStarts };
}

/** FNV-1a (32 bit) of a string: the deterministic dev / held-out split. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type EvalSplit = "dev" | "held-out";

/** Half the songs (by file name hash) are for tuning, the other half only for the final check. */
export function evalSplit(name: string): EvalSplit {
  return (fnv1a(name) & 1) === 0 ? "dev" : "held-out";
}

export interface SongScore {
  /** lines scored (anchors excluded) */
  lines: number;
  /** |estimated start − annotated start| per scored line, seconds (untimed estimates count as Infinity) */
  errors: number[];
  /** annotated sung seconds of the scored lines, and how much of it showed the right line */
  sungSeconds: number;
  rightSeconds: number;
}

/** Sampling step of the "right line on screen" measure. */
const STEP = 0.05;

/**
 * Score estimated lyrics (same lines, same order as the annotation) against the annotated times.
 * `skip` = line indices left out (the anchors of a partial 對拍). The current line at a time is
 * what the stage shows (`lineIndexAt`, the shared timeline rule).
 */
export function scoreSong(est: Lyrics, ann: readonly AnnotatedLine[], duration: number, skip: ReadonlySet<number> = new Set()): SongScore {
  const errors: number[] = [];
  let sung = 0;
  let right = 0;
  for (let i = 0; i < ann.length; i++) {
    if (skip.has(i)) continue;
    const s = est.lines[i]?.start;
    errors.push(s == null ? Infinity : Math.abs(s - ann[i].start));
    const { start, end } = ann[i];
    for (let t = start + STEP / 2; t < end; t += STEP) {
      sung += STEP;
      if (lineIndexAt(est, t, duration) === i) right += STEP;
    }
  }
  return { lines: errors.length, errors, sungSeconds: sung, rightSeconds: right };
}

export interface ScoreSummary {
  songs: number;
  lines: number;
  median: number;
  mean: number;
  within05: number;
  within1: number;
  within2: number;
  /** share of annotated sung time with the right line on screen */
  rightLine: number;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Pooled over every scored line of every song (an untimed estimate counts as a miss). */
export function summarize(scores: readonly SongScore[]): ScoreSummary {
  const all = scores.flatMap((s) => s.errors);
  const finite = all.filter(Number.isFinite);
  const share = (limit: number) => (all.length ? all.filter((e) => e <= limit).length / all.length : NaN);
  const sung = scores.reduce((a, s) => a + s.sungSeconds, 0);
  const right = scores.reduce((a, s) => a + s.rightSeconds, 0);
  return {
    songs: scores.length,
    lines: all.length,
    median: medianOf(all.map((e) => (Number.isFinite(e) ? e : 1e9))),
    mean: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : NaN,
    within05: share(0.5),
    within1: share(1),
    within2: share(2),
    rightLine: sung > 0 ? right / sung : NaN,
  };
}

/** The per-song median error (Infinity-safe). */
export function songMedian(score: SongScore): number {
  return medianOf(score.errors.map((e) => (Number.isFinite(e) ? e : 1e9)));
}

/**
 * The oracle vocal curve: 1 inside the annotated sung spans, 0 elsewhere, at `rate` frames per
 * second — the upper bound of aligning lines to "where the voice is".
 */
export function oracleVocal(ann: readonly AnnotatedLine[], duration: number, rate: number): number[] {
  const n = Math.floor(duration * rate) + 1;
  const out = new Array<number>(n).fill(0);
  for (const a of ann) {
    const i0 = Math.max(0, Math.floor(a.start * rate));
    const i1 = Math.min(n - 1, Math.ceil(a.end * rate));
    for (let i = i0; i <= i1; i++) out[i] = 1;
  }
  return out;
}

/**
 * Frame-level quality of a vocal curve against the annotated sung spans: the ROC AUC (probability
 * that a sung frame scores above a non-sung one; 0.5 = no information).
 */
export function vocalAuc(curve: readonly number[], ann: readonly AnnotatedLine[], rate: number): number {
  const truth = oracleVocal(ann, (curve.length - 1) / rate, rate);
  const pos: number[] = [];
  const neg: number[] = [];
  for (let i = 0; i < curve.length; i++) (truth[i] ? pos : neg).push(curve[i]);
  if (!pos.length || !neg.length) return NaN;
  // rank-sum (Mann-Whitney U) with ties averaged
  const all = curve.map((v, i) => ({ v, p: truth[i] === 1 })).sort((a, b) => a.v - b.v);
  let rankSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k].p) rankSum += rank;
    i = j + 1;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)} %` : "–");
const sec = (x: number) => (Number.isFinite(x) ? `${x.toFixed(2)} s` : "–");

/** One markdown table row of a summary. */
export function summaryRow(label: string, s: ScoreSummary): string {
  return `| ${label} | ${s.songs} | ${s.lines} | ${sec(s.median)} | ${sec(s.mean)} | ${pct(s.within05)} | ${pct(s.within1)} | ${pct(s.within2)} | ${pct(s.rightLine)} |`;
}

export const SUMMARY_HEADER = [
  "| | songs | lines | median \\|Δstart\\| | mean \\|Δstart\\| | ≤ 0.5 s | ≤ 1 s | ≤ 2 s | right line on screen |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
].join("\n");
