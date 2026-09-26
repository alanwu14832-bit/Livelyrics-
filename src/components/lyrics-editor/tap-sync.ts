// Tap-sync: play the song and press Space at the start of each line.

import { markStart, round3, type EditorLine } from "./editor-model";

export interface TapSession {
  /** line the session started from */
  from: number;
  /** next line to mark */
  pointer: number;
  /** indices marked in this session, in order (for Backspace) */
  marked: number[];
  /** lines as they were when the session began (Backspace restores from here) */
  original: EditorLine[];
}

/** Human taps land a little late; lyrics should rather appear slightly early than late. */
export const DEFAULT_TAP_LATENCY = 0.1;
export const MAX_TAP_LATENCY = 0.5;

export function beginTap(lines: readonly EditorLine[], from = 0): TapSession {
  const start = Math.max(0, Math.min(lines.length - 1, Math.floor(from)));
  return { from: start, pointer: start, marked: [], original: lines.slice() };
}

export function tapFinished(session: TapSession, lines: readonly EditorLine[]): boolean {
  return session.pointer >= lines.length;
}

/** Mark the current line at playhead time `t` (minus the reaction-time compensation) and advance. */
export function tapMark(
  lines: readonly EditorLine[],
  session: TapSession,
  t: number,
  latency = DEFAULT_TAP_LATENCY,
  duration?: number,
): { lines: EditorLine[]; session: TapSession } {
  if (tapFinished(session, lines) || !Number.isFinite(t)) return { lines: lines as EditorLine[], session };
  const time = round3(Math.max(0, t - Math.max(0, latency)));
  return {
    lines: markStart(lines, session.pointer, time, duration),
    session: { ...session, pointer: session.pointer + 1, marked: [...session.marked, session.pointer] },
  };
}

/** Skip the current line without marking it. */
export function tapSkip(lines: readonly EditorLine[], session: TapSession): TapSession {
  if (tapFinished(session, lines)) return session;
  return { ...session, pointer: session.pointer + 1 };
}

/**
 * Backspace: un-mark the last marked line (restoring its pre-session timing) and make it the
 * current line again. Returns restored = null when nothing was marked yet.
 */
export function tapUndo(lines: readonly EditorLine[], session: TapSession): { lines: EditorLine[]; session: TapSession; restored: number | null } {
  const marked = session.marked.slice();
  const idx = marked.pop();
  if (idx == null) {
    // nothing marked: step back over skipped lines
    if (session.pointer > session.from) return { lines: lines as EditorLine[], session: { ...session, pointer: session.pointer - 1 }, restored: null };
    return { lines: lines as EditorLine[], session, restored: null };
  }
  const out = lines.slice();
  const original = session.original[idx];
  if (original && out[idx]?.key === original.key) out[idx] = original;
  // the line before it had its end re-derived by the mark; restore it unless it was marked too
  const prevIdx = idx - 1;
  const prevOriginal = session.original[prevIdx];
  if (prevIdx >= 0 && !marked.includes(prevIdx) && prevOriginal && out[prevIdx]?.key === prevOriginal.key && out[prevIdx].end !== prevOriginal.end) {
    out[prevIdx] = { ...out[prevIdx], end: prevOriginal.end };
  }
  return { lines: out, session: { ...session, pointer: idx, marked }, restored: idx };
}

/** Where playback should start so the operator hears the lead-in to line `index`. */
export function preRollTime(lines: readonly EditorLine[], index: number): number {
  if (index <= 0) return 0;
  for (let k = index - 1; k >= 0; k--) {
    const s = lines[k].start;
    if (s != null) return Math.max(0, round3(s - 0.5));
  }
  const own = lines[index]?.start;
  return own != null ? Math.max(0, round3(own - 4)) : 0;
}
