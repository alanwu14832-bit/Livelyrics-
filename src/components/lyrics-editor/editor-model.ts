// Pure editing operations for the lyrics editor. Lines keep a local React key; ids
// ("l0"...) are only assigned by normalizeLyrics when saving.

import type { LyricWord, Lyrics, LyricsSource } from "@/lib/types";

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
}

/** a line end closer than this to the next start counts as "contiguous" (derived) */
const CONTIGUOUS_EPS = 0.05;
/** matches the stage/timeline rule: a derived line end never lingers past start + 10 s */
const MAX_DERIVED_SECONDS = 10;
const MIN_LINE_SECONDS = 0.2;

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
    out.push(line);
  }
  return out;
}

/** Raw Lyrics for saving (pass the result through normalizeLyrics). */
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
      return line;
    }),
  };
  if (base.language) out.language = base.language;
  return out;
}

/** Stable fingerprint of the saved content (dirty tracking). */
export function contentKey(lines: readonly EditorLine[], source: LyricsSource): string {
  return JSON.stringify([
    source,
    lines.map((l) => [l.text.trim(), l.translation.trim(), l.start, l.start != null ? l.end : null, l.words?.length ?? 0]),
  ]);
}

// ---------------------------------------------------------------------------
// timing
// ---------------------------------------------------------------------------

/** Move a line to `start` (null = untimed). Explicit end and word timings move with it. */
export function retimeLine(line: EditorLine, start: number | null, duration?: number): EditorLine {
  if (start == null || !Number.isFinite(start)) {
    if (line.start == null && !line.words && line.end == null) return line;
    return withoutWords({ ...line, start: null, end: null });
  }
  let s = Math.max(0, start);
  if (duration && duration > 0) s = Math.min(s, duration);
  s = round3(s);
  if (line.start == null) return withoutWords({ ...line, start: s, end: null });
  if (s === line.start) return line;
  const d = s - line.start;
  const end = line.end != null && line.end + d > s + MIN_LINE_SECONDS ? round3(line.end + d) : null;
  const next: EditorLine = { ...line, start: s, end };
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
  out.splice(pos, 0, blankLine(start));
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
  const second: EditorLine = {
    key: newLineKey(),
    text: right,
    translation: "",
    start: rightStart,
    end: rightStart != null && line.end != null && line.end > rightStart ? line.end : null,
  };
  if (rightWords) second.words = rightWords;
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
