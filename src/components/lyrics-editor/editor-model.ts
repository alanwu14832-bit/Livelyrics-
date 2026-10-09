// Pure editing operations for the lyrics editor. Lines keep a local React key; ids
// ("l0"...) are only assigned by normalizeLyrics when saving.

import { applyAnchors, type LineAnchor } from "@/lib/lyrics/asr-align";
import { estimatedFlags, placeUntimed, type DistributeOptions } from "@/lib/lyrics/lrc";
import type { AudioAnalysis, LyricLine, LyricWord, Lyrics, LyricsSource } from "@/lib/types";

export interface EditorLine {
  /** local, stable React key (not the saved line id) */
  key: string;
  text: string;
  translation: string;
  /** seconds; null = untimed */
  start: number | null;
  /**
   * explicit end, only when the line really ends before the next one starts (a gap) or
   * for the last line; null = derived from the next line's start when saving
   */
  end: number | null;
  words?: LyricWord[];
  /**
   * the start is a guess (自動分配 / 人聲估算, LyricLine.estimated): tapping, dragging or typing
   * the start makes the line real
   */
  estimated?: boolean;
  /**
   * round 15: the estimated start came from 「AI 自動對時」 (LyricLine.aligned): re-estimating
   * around a tap keeps it unless it contradicts a real line
   */
  aligned?: boolean;
}

/** a line end closer than this to the next start counts as "contiguous" (derived) */
const CONTIGUOUS_EPS = 0.05;
/** matches the stage/timeline rule: a derived line end never lingers past start + 10 s */
const MAX_DERIVED_SECONDS = 10;
const MIN_LINE_SECONDS = 0.2;
/** an AI-aligned start this close to (or past) a real neighbour contradicts it */
const ALIGNED_MIN_GAP = 0.3;

let keySeq = 0;
export function newLineKey(): string {
  keySeq += 1;
  return `k${keySeq.toString(36)}`;
}

export function round3(t: number): number {
  return Math.round(t * 1000) / 1000;
}

function withoutWords(line: EditorLine): EditorLine {
  if (!line.words) return line;
  const copy = { ...line };
  delete copy.words;
  return copy;
}

function nextTimedStart(lines: readonly EditorLine[], index: number): number | null {
  for (let k = index + 1; k < lines.length; k++) {
    const s = lines[k].start;
    if (s != null) return s;
  }
  return null;
}

function prevTimedStart(lines: readonly EditorLine[], index: number): number | null {
  for (let k = index - 1; k >= 0; k--) {
    const s = lines[k].start;
    if (s != null) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// conversion
// ---------------------------------------------------------------------------

export function fromLyrics(lyrics: Lyrics | null | undefined): EditorLine[] {
  const src = lyrics?.lines ?? [];
  const flags = estimatedFlags(lyrics);
  const out: EditorLine[] = [];
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    let nextStart: number | null = null;
    for (let k = i + 1; k < src.length; k++) {
      if (src[k].start != null) {
        nextStart = src[k].start;
        break;
      }
    }
    let end: number | null = null;
    if (l.start != null && l.end != null && l.end > l.start) {
      if (nextStart == null || l.end < nextStart - CONTIGUOUS_EPS) end = l.end;
    }
    const line: EditorLine = { key: newLineKey(), text: l.text ?? "", translation: l.translation ?? "", start: l.start ?? null, end };
    if (l.start != null && l.words && l.words.length) line.words = l.words.map((w) => ({ ...w }));
    if (flags[i]) line.estimated = true;
    if (flags[i] && l.aligned) line.aligned = true;
    out.push(line);
  }
  return out;
}

/** Raw Lyrics for saving (pass the result through normalizeLyrics); `timing` follows the per-line flags. */
export function toLyrics(lines: readonly EditorLine[], base: { source: LyricsSource; language?: string }): Lyrics {
  const out: Lyrics = {
    source: base.source,
    synced: false,
    lines: lines.map((l, i) => {
      const line: Lyrics["lines"][number] = {
        id: `l${i}`,
        text: l.text.trim(),
        start: l.start,
        end: l.start != null ? l.end : null,
      };
      const tr = l.translation.trim();
      if (tr) line.translation = tr;
      if (l.start != null && l.words && l.words.length) line.words = l.words;
      if (l.start != null && l.estimated) line.estimated = true;
      if (l.start != null && l.estimated && l.aligned) line.aligned = true;
      return line;
    }),
  };
  if (base.language) out.language = base.language;
  if (out.lines.some((l) => l.estimated)) out.timing = "estimated";
  return out;
}

/** Stable fingerprint of the saved content (dirty tracking); a tap that lands on the estimated time still counts. */
export function contentKey(lines: readonly EditorLine[], source: LyricsSource): string {
  return JSON.stringify([
    source,
    lines.map((l) => [l.text.trim(), l.translation.trim(), l.start, l.start != null ? l.end : null, l.words?.length ?? 0, l.start != null && l.estimated ? (l.aligned ? 2 : 1) : 0]),
  ]);
}

// ---------------------------------------------------------------------------
// timing
// ---------------------------------------------------------------------------

function real(line: EditorLine): EditorLine {
  if (!line.estimated && !line.aligned) return line;
  const copy = { ...line };
  delete copy.estimated;
  delete copy.aligned;
  return copy;
}

/**
 * Move a line to `start` (null = untimed). Explicit end and word timings move with it. A time set
 * here comes from the operator (typed, dragged, nudged, tapped): the line is no longer estimated,
 * even when the time lands where the estimate was.
 */
export function retimeLine(line: EditorLine, start: number | null, duration?: number): EditorLine {
  if (start == null || !Number.isFinite(start)) {
    if (line.start == null && !line.words && line.end == null && !line.estimated) return line;
    return real(withoutWords({ ...line, start: null, end: null }));
  }
  let s = Math.max(0, start);
  if (duration && duration > 0) s = Math.min(s, duration);
  s = round3(s);
  if (line.start == null) return real(withoutWords({ ...line, start: s, end: null }));
  if (s === line.start) return real(line);
  const d = s - line.start;
  const end = line.end != null && line.end + d > s + MIN_LINE_SECONDS ? round3(line.end + d) : null;
  const next: EditorLine = real({ ...line, start: s, end });
  if (line.words) next.words = line.words.map((w) => ({ text: w.text, start: round3(Math.max(0, w.start + d)), end: round3(Math.max(0, w.end + d)) }));
  return next;
}

export function setStart(lines: readonly EditorLine[], index: number, start: number | null, duration?: number): EditorLine[] {
  if (index < 0 || index >= lines.length) return lines as EditorLine[];
  const updated = retimeLine(lines[index], start, duration);
  if (updated === lines[index]) return lines as EditorLine[];
  const out = lines.slice();
  out[index] = updated;
  return out;
}

export function nudge(lines: readonly EditorLine[], index: number, delta: number, duration?: number): EditorLine[] {
  const line = lines[index];
  if (!line || line.start == null) return lines as EditorLine[];
  return setStart(lines, index, line.start + delta, duration);
}

/**
 * Tap-sync mark: set the line's start and make the previous line end exactly here
 * (its explicit end is dropped so it is derived from this start).
 */
export function markStart(lines: readonly EditorLine[], index: number, start: number, duration?: number): EditorLine[] {
  const out = setStart(lines, index, start, duration).slice();
  const prev = out[index - 1];
  if (prev && prev.start != null && prev.end != null) out[index - 1] = { ...prev, end: null };
  return out;
}

export function clearAllTimes(lines: readonly EditorLine[]): EditorLine[] {
  return lines.map((l) => retimeLine(l, null));
}

/** Sort by time; untimed lines stay right after the timed line they followed (same rule as normalizeLyrics). */
export function sortByTime(lines: readonly EditorLine[]): EditorLine[] {
  let lastKey = -1;
  const keyed = lines.map((l, order) => {
    const key = l.start ?? lastKey;
    if (l.start != null) lastKey = l.start;
    return { l, order, key };
  });
  keyed.sort((a, b) => a.key - b.key || (a.l.start == null ? 1 : 0) - (b.l.start == null ? 1 : 0) || a.order - b.order);
  return keyed.map((k) => k.l);
}

/** true for timed lines that start before an earlier timed line (saving will reorder them). */
export function outOfOrderFlags(lines: readonly EditorLine[]): boolean[] {
  let max = -Infinity;
  return lines.map((l) => {
    if (l.start == null) return false;
    const bad = l.start < max - 1e-6;
    if (l.start > max) max = l.start;
    return bad;
  });
}

export function timedCount(lines: readonly EditorLine[]): number {
  let n = 0;
  for (const l of lines) if (l.start != null) n++;
  return n;
}

/** Lines whose start is still a guess. */
export function estimatedCount(lines: readonly EditorLine[]): number {
  let n = 0;
  for (const l of lines) if (l.start != null && l.estimated) n++;
  return n;
}

/** Estimated lines whose start came from 「AI 自動對時」. */
export function alignedCount(lines: readonly EditorLine[]): number {
  let n = 0;
  for (const l of lines) if (l.start != null && l.estimated && l.aligned) n++;
  return n;
}

/**
 * The AI-aligned rows that still agree with the real ones: their start lies at least
 * ALIGNED_MIN_GAP after the previous real start and before the next real start.
 */
function keptAligned(lines: readonly EditorLine[]): boolean[] {
  const real = lines.map((l) => l.start != null && !l.estimated);
  const nextReal: number[] = new Array(lines.length).fill(Infinity);
  for (let i = lines.length - 2; i >= 0; i--) nextReal[i] = real[i + 1] ? (lines[i + 1].start as number) : nextReal[i + 1];
  let prevReal = -Infinity;
  return lines.map((l, i) => {
    const keep = l.start != null && !!l.estimated && !!l.aligned && l.start >= prevReal + ALIGNED_MIN_GAP && l.start <= nextReal[i] - ALIGNED_MIN_GAP;
    if (real[i]) prevReal = l.start as number;
    return keep;
  });
}

export type ReestimateMode =
  /** the estimated lines between the real ones (untimed lines stay untimed) — after 對拍 or a manual edit */
  | "estimated"
  /** the estimated and the untimed lines (重新估算『估的』行) */
  | "estimated+untimed"
  /** only the untimed lines (分配未定時的行) */
  | "untimed"
  /** every line, real ones too (重新分配全部) */
  | "all";

/**
 * Lay lines out again with `distributeLines`' estimator (the 人聲 curve when the analysis has one,
 * else the loudness spread), in place: the rows keep their keys, order and text; real lines never
 * move (except in "all"). The re-laid lines are flagged estimated.
 */
export function reestimate(lines: readonly EditorLine[], analysis: AudioAnalysis | null, duration: number, mode: ReestimateMode = "estimated", options: DistributeOptions = {}): EditorLine[] {
  // round 15: after a tap the lines 「AI 自動對時」 placed stay (unless a real line now contradicts them)
  const soft = mode === "estimated" ? keptAligned(lines) : lines.map(() => false);
  const redo = lines.map((l, i) => !soft[i] && (mode === "all" || (l.start == null ? mode !== "estimated" : !!l.estimated && mode !== "untimed")));
  // untimed rows take part in the layout (they are sung too) but stay untimed in "estimated" mode
  const layout = lines.map((l, i) => redo[i] || l.start == null);
  if (!redo.some(Boolean)) return lines as EditorLine[];
  const raw: LyricLine[] = lines.map((l, i) => ({ id: l.key, text: l.text, start: layout[i] ? null : l.start, end: layout[i] ? null : l.end }));
  const placed = placeUntimed(raw, analysis, duration, options);
  const out = lines.map((l, i) => {
    if (!redo[i]) return l;
    const start = placed[i]?.start ?? null;
    if (start == null) return retimeLine(l, null);
    const line: EditorLine = withoutWords({ ...l, start: round3(start), end: null, estimated: true });
    delete line.aligned;
    return line;
  });
  // explicit ends only where a gap follows (the same rule as fromLyrics)
  for (let i = 0; i < out.length; i++) {
    if (!redo[i] || out[i].start == null) continue;
    const end = placed[i]?.end;
    const start = out[i].start as number;
    if (end == null || !(end > start)) continue;
    let nextStart: number | null = null;
    for (let k = i + 1; k < out.length; k++) {
      if (out[k].start != null) {
        nextStart = out[k].start;
        break;
      }
    }
    if (nextStart == null || end < nextStart - CONTIGUOUS_EPS) out[i] = { ...out[i], end: round3(end) };
  }
  return out;
}

/**
 * 「AI 自動對時」 (round 15): apply the anchors of `alignTranscript` in place — the real rows never
 * move, the anchored rows take the AI's start (estimated, `aligned`), every other row is laid out
 * between them by the 人聲 aligner (estimated). Keys, order and text stay.
 */
export function applyAsrTiming(lines: readonly EditorLine[], anchors: readonly LineAnchor[], analysis: AudioAnalysis | null, duration: number): EditorLine[] {
  const raw: LyricLine[] = lines.map((l) => {
    const line: LyricLine = { id: l.key, text: l.text, start: l.start, end: l.start != null ? l.end : null };
    if (l.start != null && l.estimated) line.estimated = true;
    return line;
  });
  const { lines: placed } = applyAnchors(raw, anchors, analysis, duration);
  const out = lines.map((l, i) => {
    if (l.start != null && !l.estimated) return l;
    const p = placed[i];
    if (p?.start == null) return retimeLine(l, null);
    const line: EditorLine = withoutWords({ ...l, start: round3(p.start), end: null, estimated: true });
    if (p.aligned) line.aligned = true;
    else delete line.aligned;
    return line;
  });
  // explicit ends only where a gap follows (the same rule as fromLyrics)
  for (let i = 0; i < out.length; i++) {
    if (out[i] === lines[i] || out[i].start == null) continue;
    const end = placed[i]?.end;
    const start = out[i].start as number;
    if (end == null || !(end > start)) continue;
    const nextStart = nextTimedStart(out, i);
    if (nextStart == null || end < nextStart - CONTIGUOUS_EPS) out[i] = { ...out[i], end: round3(end) };
  }
  return out;
}

/** 確認全部時間: every estimated start becomes real (the song can then run in 跟音檔). */
export function confirmAllTimes(lines: readonly EditorLine[]): EditorLine[] {
  if (!lines.some((l) => l.estimated || l.aligned)) return lines as EditorLine[];
  return lines.map(real);
}

/** Effective end of a line for display/playback (explicit, next start, or a capped default). */
export function effectiveEnd(lines: readonly EditorLine[], index: number, duration?: number): number | null {
  const l = lines[index];
  if (!l || l.start == null) return null;
  if (l.end != null && l.end > l.start) return l.end;
  const next = nextTimedStart(lines, index);
  let end = next != null && next > l.start ? next : l.start + 6;
  end = Math.min(end, l.start + MAX_DERIVED_SECONDS);
  if (duration && duration > 0) end = Math.min(end, Math.max(duration, l.start + MIN_LINE_SECONDS));
  return Math.max(end, l.start + MIN_LINE_SECONDS);
}

// ---------------------------------------------------------------------------
// structure
// ---------------------------------------------------------------------------

export function blankLine(start: number | null = null): EditorLine {
  return { key: newLineKey(), text: "", translation: "", start: start == null ? null : round3(start), end: null };
}

/** Insert a blank line at `position` (0..length). Its start is placed between its neighbours when they are timed. */
export function insertLine(lines: readonly EditorLine[], position: number, duration?: number): { lines: EditorLine[]; index: number } {
  const pos = Math.max(0, Math.min(lines.length, Math.floor(position)));
  const prev = prevTimedStart(lines, pos);
  const next = nextTimedStart(lines, pos - 1);
  let start: number | null = null;
  if (prev != null && next != null && next > prev) start = (prev + next) / 2;
  else if (prev != null && pos > 0 && lines[pos - 1].start != null) start = prev + 2;
  if (start != null && duration && duration > 0) start = Math.min(start, duration);
  const out = lines.slice();
  const line = blankLine(start);
  // a start placed between the neighbours is a guess until the operator times the line
  if (line.start != null) line.estimated = true;
  out.splice(pos, 0, line);
  return { lines: out, index: pos };
}

export function removeLine(lines: readonly EditorLine[], index: number): EditorLine[] {
  if (index < 0 || index >= lines.length) return lines as EditorLine[];
  const out = lines.slice();
  out.splice(index, 1);
  return out;
}

function joinText(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  if (!x) return y;
  if (!y) return x;
  return `${x} ${y}`;
}

/** Merge line `index` with the next one. */
export function mergeWithNext(lines: readonly EditorLine[], index: number): EditorLine[] {
  if (index < 0 || index + 1 >= lines.length) return lines as EditorLine[];
  const a = lines[index];
  const b = lines[index + 1];
  const start = a.start ?? b.start;
  const merged: EditorLine = {
    key: a.key,
    text: joinText(a.text, b.text),
    translation: joinText(a.translation, b.translation),
    start,
    end: start != null && b.end != null && b.end > start ? b.end : null,
  };
  if (start != null && (a.start != null ? a.estimated : b.estimated)) merged.estimated = true;
  if (merged.estimated && (a.start != null ? a.aligned : b.aligned)) merged.aligned = true;
  if (a.start != null && b.start != null && a.words?.length && b.words?.length && a.text.trim() && b.text.trim()) {
    const first = a.words.map((w) => ({ ...w }));
    first[first.length - 1].text = first[first.length - 1].text.replace(/\s*$/, " ");
    merged.words = [...first, ...b.words.map((w) => ({ ...w }))];
  }
  const out = lines.slice();
  out.splice(index, 2, merged);
  return out;
}

const BREAK_CHARS = /[\s,，、。．.!！?？;；:：~～…—–\-]/;

/** A natural split point near the middle: whitespace/punctuation first, else the middle character. */
export function defaultSplitPoint(text: string): number {
  const chars = Array.from(text);
  if (chars.length < 2) return chars.length;
  const mid = chars.length / 2;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 1; i < chars.length; i++) {
    if (BREAK_CHARS.test(chars[i]) || BREAK_CHARS.test(chars[i - 1])) {
      const d = Math.abs(i - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  const at = best > 0 && bestDist <= chars.length / 3 ? best : Math.round(mid);
  // back to a UTF-16 offset
  return chars.slice(0, at).join("").length;
}

/**
 * Split line `index` at UTF-16 offset `caret` (default: a natural point near the middle).
 * The second part gets a proportional start time; returns null when one side would be empty.
 */
export function splitLine(lines: readonly EditorLine[], index: number, caret?: number, duration?: number): { lines: EditorLine[]; index: number } | null {
  const line = lines[index];
  if (!line) return null;
  const text = line.text;
  const at = Math.max(0, Math.min(text.length, caret ?? defaultSplitPoint(text)));
  const left = text.slice(0, at).trim();
  const right = text.slice(at).trim();
  if (!left || !right) return null;

  let leftWords: EditorLine["words"];
  let rightWords: EditorLine["words"];
  let rightStart: number | null = null;
  if (line.start != null) {
    if (line.words?.length && line.words.map((w) => w.text).join("").trim() === text.trim()) {
      // split on a word boundary when the caret sits on one
      let acc = text.length - text.trimStart().length;
      let cut = -1;
      for (let k = 0; k < line.words.length; k++) {
        if (acc >= at) {
          cut = k;
          break;
        }
        acc += line.words[k].text.length;
      }
      if (cut > 0 && Math.abs(acc - at) <= 1) {
        leftWords = line.words.slice(0, cut).map((w) => ({ ...w }));
        leftWords[leftWords.length - 1].text = leftWords[leftWords.length - 1].text.trimEnd();
        rightWords = line.words.slice(cut).map((w) => ({ ...w }));
        rightStart = rightWords[0].start;
      }
    }
    if (rightStart == null) {
      const end = effectiveEnd(lines, index, duration) ?? line.start + 4;
      const ratio = Array.from(text.slice(0, at)).length / Math.max(1, Array.from(text).length);
      rightStart = round3(line.start + (end - line.start) * ratio);
    }
  }

  const first: EditorLine = { key: line.key, text: left, translation: line.translation, start: line.start, end: null };
  if (leftWords) first.words = leftWords;
  if (line.estimated && line.start != null) first.estimated = true;
  if (first.estimated && line.aligned) first.aligned = true;
  const second: EditorLine = {
    key: newLineKey(),
    text: right,
    translation: "",
    start: rightStart,
    end: rightStart != null && line.end != null && line.end > rightStart ? line.end : null,
  };
  if (rightWords) second.words = rightWords;
  // a word boundary keeps the line's provenance; a proportional split point is a guess
  if (rightStart != null && (line.estimated || !rightWords)) second.estimated = true;
  const out = lines.slice();
  out.splice(index, 1, first, second);
  return { lines: out, index: index + 1 };
}

export function updateText(lines: readonly EditorLine[], index: number, field: "text" | "translation", value: string): EditorLine[] {
  const line = lines[index];
  if (!line || line[field] === value) return lines as EditorLine[];
  const out = lines.slice();
  const next: EditorLine = { ...line, [field]: value };
  // word timings no longer match edited text
  out[index] = field === "text" ? withoutWords(next) : next;
  return out;
}

// ---------------------------------------------------------------------------
// time text
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** m:ss.cc (rounded to centiseconds). */
export function formatTimeInput(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const cs = Math.max(0, Math.round(seconds * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  return `${m}:${pad2(s)}.${pad2(cs % 100)}`;
}

/**
 * Parse "1:23.45", "01:23.450", "83.5", "1:23", "1：23．4", "0:01:23.5".
 * Returns null for an empty value (= untimed) and undefined when invalid.
 */
export function parseTimeInput(input: string): number | null | undefined {
  const s = input
    .normalize("NFKC")
    .trim()
    .replace(/[′']/g, ":")
    .replace(/[″"]/g, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
  if (!s || s === "-" || s === "—" || s === "--") return null;
  const frac = (f: string | undefined) => (f ? Number(`0.${f}`) : 0);
  let m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(s);
  if (m) {
    if (Number(m[2]) >= 60 || Number(m[3]) >= 60) return undefined;
    return round3(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac(m[4]));
  }
  m = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(s);
  if (m) {
    if (Number(m[2]) >= 60) return undefined;
    return round3(Number(m[1]) * 60 + Number(m[2]) + frac(m[3]));
  }
  m = /^(\d{1,5})(?:\.(\d{1,3}))?$/.exec(s) ?? /^()\.(\d{1,3})$/.exec(s);
  if (m) return round3(Number(m[1] || 0) + frac(m[2]));
  return undefined;
}

/** Index of the line sounding at time t (latest start ≤ t still inside its span), or null. */
export function lineAt(lines: readonly EditorLine[], t: number, duration?: number): number | null {
  let best: number | null = null;
  let bestStart = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].start;
    if (s == null || s > t || s < bestStart) continue;
    best = i;
    bestStart = s;
  }
  if (best == null) return null;
  const end = effectiveEnd(lines, best, duration);
  return end != null && t < end ? best : null;
}
