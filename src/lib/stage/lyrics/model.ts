// Prepares a lyric line for display: tokens + timing + emphasis + row breaks.
// Pure; the DOM lyric layer builds elements from a PreparedLine.

import { lineSpan } from "../../timeline";
import type { LyricLine } from "../../types";
import { unitEmphasis, emphasisMask } from "./emphasis";
import { breakLyricText, breakUnits } from "./linebreak";
import { estimateSungDuration, synthesizeTiming, timingFromWords, sungEnd, type TimedUnit } from "./timing";
import { tokenizeLyric } from "./tokenize";

export interface PreparedLine {
  index: number;
  id: string;
  text: string;
  units: TimedUnit[];
  /** per unit */
  emphasis: boolean[];
  /** unit indices per display row (column in vertical mode), trimmed */
  rows: number[][];
  translation: string | null;
  translationRows: string[];
  /** absolute [start, end) seconds, or null when the line is untimed */
  span: [number, number] | null;
  /** seconds from line start until the last unit finishes */
  sungDuration: number;
  /** true when timing came from line.words */
  wordTimed: boolean;
}

export interface PrepareOptions {
  maxChars: number;
  maxLines: number;
  songDuration: number;
  emphasis: readonly string[];
}

export function prepareLine(lines: readonly LyricLine[], index: number, opts: PrepareOptions): PreparedLine | null {
  const line = lines[index];
  if (!line || typeof line.text !== "string") return null;
  const text = line.text.replace(/\s+/g, " ").trim();
  const span = lineSpan(lines as LyricLine[], index, opts.songDuration);
  const tokens = tokenizeLyric(text);

  let units: TimedUnit[] | null = null;
  let wordTimed = false;
  if (span && Array.isArray(line.words) && line.words.length > 0) {
    units = timingFromWords(text, tokens, line.words, span[0]);
    wordTimed = units != null;
  }
  if (!units) {
    const spanDuration = span ? span[1] - span[0] : null;
    units = synthesizeTiming(tokens, estimateSungDuration(tokens, spanDuration));
  }

  const emphasis = unitEmphasis(units, emphasisMask(text, opts.emphasis));
  const indexOf = new Map<TimedUnit, number>();
  units.forEach((u, i) => indexOf.set(u, i));
  const rows = breakUnits(units, { maxChars: opts.maxChars, maxLines: opts.maxLines }).map((row) =>
    row.map((u) => indexOf.get(u as TimedUnit) ?? -1).filter((i) => i >= 0),
  );

  const translation = typeof line.translation === "string" && line.translation.trim() ? line.translation.trim() : null;
  const translationRows = translation ? breakLyricText(translation, { maxChars: Math.round(Math.max(opts.maxChars, 16) * 1.7), maxLines: 2 }) : [];

  return {
    index,
    id: line.id,
    text,
    units,
    emphasis,
    rows,
    translation,
    translationRows,
    span,
    sungDuration: Math.max(0.2, sungEnd(units)),
    wordTimed,
  };
}

/**
 * Seconds since the line started: from song time for timed lines, otherwise
 * from the moment the console cued it (lineStartedAt, epoch ms).
 */
export function lineElapsed(line: PreparedLine, t: number, lineStartedAt: number, nowEpochMs: number): number {
  if (line.span) return t - line.span[0];
  if (!Number.isFinite(lineStartedAt)) return 0;
  return Math.max(0, (nowEpochMs - lineStartedAt) / 1000);
}
