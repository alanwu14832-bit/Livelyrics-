// Pure lyric / section / cue navigation used by the console controller and UI.

import { lineIndexAt, sectionIndexForLine } from "@/lib/timeline";
import type { CueNote, DesignPlan, LyricLine, Lyrics } from "@/lib/types";

/** Tolerance so a jump that lands exactly on a line start does not re-target that same line. */
const EPS = 0.05;

function isTimed(line: LyricLine | undefined): line is LyricLine & { start: number } {
  return !!line && typeof line.start === "number" && Number.isFinite(line.start);
}

/** Index of the last timed line whose start <= t (ignores whether its span is over), or null. */
export function lastStartedLine(lines: readonly LyricLine[], t: number): number | null {
  let found: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isTimed(line)) continue;
    if (line.start <= t + 1e-6) found = i;
    else break;
  }
  return found;
}

/** Next timed line strictly after time t (with a small tolerance), or null. */
export function nextTimedLineAfter(lines: readonly LyricLine[], t: number): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isTimed(line) && line.start > t + EPS) return i;
  }
  return null;
}

/** Track mode "next line": the first timed line starting after t. */
export function trackNextLine(lyrics: Lyrics, t: number): number | null {
  return nextTimedLineAfter(lyrics.lines, t);
}

/**
 * Track mode "previous line": the timed line before the active one; during a gap
 * (no active line) the most recently started line, so it can be replayed.
 */
export function trackPrevLine(lyrics: Lyrics, t: number, songDuration: number): number | null {
  const lines = lyrics.lines;
  const active = lineIndexAt(lyrics, t + 1e-6, songDuration);
  if (active == null) return lastStartedLine(lines, t);
  for (let i = active - 1; i >= 0; i--) if (isTimed(lines[i])) return i;
  return null;
}

/**
 * Live mode: the time at which the virtual clock started by cueing `index` must hold —
 * the start of the next timed line after it (strictly later than `from`), or null to run on.
 */
export function liveHoldTime(lines: readonly LyricLine[], index: number, from: number): number | null {
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isTimed(line) && line.start > from + 1e-6) return line.start;
  }
  return null;
}

/** Live mode "next": the line after the current / last cued one; before anything was cued, the first line at or after t. */
export function liveNextLine(lines: readonly LyricLine[], current: number | null, lastCued: number | null, t: number): number | null {
  if (lines.length === 0) return null;
  const ref = current ?? lastCued;
  if (ref != null) return ref + 1 < lines.length ? ref + 1 : null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isTimed(line) || line.start >= t - EPS) return i;
  }
  return null;
}

/** Live mode "previous": the line before the current / last cued one. */
export function livePrevLine(lines: readonly LyricLine[], current: number | null, lastCued: number | null): number | null {
  const ref = current ?? lastCued;
  if (ref == null) return null;
  return ref > 0 ? ref - 1 : 0;
}

/**
 * Section index a lyric line belongs to — the same rule the stage uses for its lyric style
 * (a line sung into a section a beat early belongs to it) — or null for untimed lines / no plan.
 */
export function sectionOfLine(plan: DesignPlan | null, lines: LyricLine[], index: number, songDuration: number): number | null {
  if (!plan || plan.sections.length === 0 || !isTimed(lines[index])) return null;
  return sectionIndexForLine(plan, lines, index, songDuration);
}

/**
 * The section every line belongs to, the way the lyrics list groups them: a timed line its own
 * (sectionOfLine), an untimed line the one of the timed line before it (null before the first
 * timed line, or without a plan).
 */
export function lineSections(plan: DesignPlan | null, lines: LyricLine[], songDuration: number): Array<number | null> {
  let current: number | null = null;
  return lines.map((_, i) => {
    const own = sectionOfLine(plan, lines, i, songDuration);
    if (own != null) current = own;
    return own ?? current;
  });
}

/** Lines of section `index` in order (see lineSections). */
export function linesInSection(plan: DesignPlan | null, lines: LyricLine[], index: number, songDuration: number): number[] {
  const out: number[] = [];
  lineSections(plan, lines, songDuration).forEach((s, i) => {
    if (s === index) out.push(i);
  });
  return out;
}

/**
 * LIVE 循環段落: the line the next cue shows instead of the normal next one — the section's first
 * line after its last — or null when the normal next line applies (`ref`, the line on screen or
 * cued last, is not the looped section's last line).
 */
export function loopNextLine(sectionLines: readonly number[], ref: number | null): number | null {
  if (sectionLines.length === 0 || ref == null) return null;
  return sectionLines[sectionLines.length - 1] === ref ? sectionLines[0] : null;
}

/** How early (s) TRACK playback jumps back: the console's clock ticks every 33 ms. */
export const LOOP_LOOKAHEAD = 0.02;

/**
 * TRACK 循環段落: where playback jumps back to (the looped section's start) once it reaches the
 * section's end, or null while it is still inside.
 */
export function loopSeekTarget(section: { start: number; end: number } | null | undefined, t: number, lookahead = LOOP_LOOKAHEAD): number | null {
  if (!section || !Number.isFinite(section.start) || !Number.isFinite(section.end) || section.end <= section.start || !Number.isFinite(t)) return null;
  // a section shorter than the lookahead would loop forever on the spot
  const edge = Math.max(section.start + 0.1, section.end - lookahead);
  return t >= edge ? section.start : null;
}

export interface UpcomingCue {
  index: number;
  cue: CueNote;
  /** seconds until the cue (<= 0 while it is "now") */
  inSeconds: number;
}

/** How long a cue counts as "now" after its time passed. */
export const CUE_ACTIVE_WINDOW = 2;

/**
 * The cue the operator should prepare for: the first cue whose time is still ahead,
 * or the one that fired less than CUE_ACTIVE_WINDOW seconds ago.
 */
export function upcomingCue(cues: readonly CueNote[], t: number): UpcomingCue | null {
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!Number.isFinite(cue.time)) continue;
    if (cue.time > t - CUE_ACTIVE_WINDOW) return { index: i, cue, inSeconds: cue.time - t };
  }
  return null;
}

/** Cues in time order (the plan should already be sorted; this guards against hand edits). */
export function sortedCues(plan: DesignPlan | null): CueNote[] {
  if (!plan || !Array.isArray(plan.cues)) return [];
  return plan.cues.filter((c) => Number.isFinite(c.time)).sort((a, b) => a.time - b.time);
}

/** Count of lines without a start time. */
export function untimedCount(lyrics: Lyrics): number {
  return lyrics.lines.reduce((n, l) => (isTimed(l) ? n : n + 1), 0);
}

/** Share of lines that carry a start time (0..1; 0 for no lines). */
export function timedRatio(lyrics: Lyrics): number {
  if (lyrics.lines.length === 0) return 0;
  return 1 - untimedCount(lyrics) / lyrics.lines.length;
}

/** Best effective song duration from the audio element, meta, analysis and lyrics. */
export function effectiveDuration(
  audioDuration: number | null | undefined,
  metaDuration: number | null | undefined,
  analysisDuration: number | null | undefined,
  lyrics: Lyrics | null | undefined,
): number {
  for (const d of [audioDuration, metaDuration, analysisDuration]) {
    if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;
  }
  let last = 0;
  for (const l of lyrics?.lines ?? []) {
    if (typeof l.end === "number" && Number.isFinite(l.end)) last = Math.max(last, l.end);
    if (typeof l.start === "number" && Number.isFinite(l.start)) last = Math.max(last, l.start + 4);
  }
  return last > 0 ? last : 0;
}
