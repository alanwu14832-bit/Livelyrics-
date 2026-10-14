// Round 19 (M6): the lyric timing a design was made with, and whether it has moved since. The
// sections, cues and type of a plan follow the line times it was designed against; when
// 「AI 自動對時」, 確認全部時間 or a large edit moves any line by more than TIMING_CHANGE_SECONDS,
// the editor and the console suggest a re-design. Pure (the PATCH route records it on the project).

import type { Lyrics, TimingChange, TimingPoint } from "../types";

/** A line whose start moved by more than this (seconds), or that got its first time, counts. */
export const TIMING_CHANGE_SECONDS = 2;

/** How many baseline lines ahead a renamed / inserted line may push the match (keeps it linear). */
const LOOKAHEAD = 12;

export const TIMING_CHANGE_TITLE = "歌詞時間改了，建議重新設計段落與提示";

const key = (text: string) =>
  String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** The line texts and starts of a lyrics version (what a plan was designed against). */
export function timingSnapshot(lyrics: Lyrics | null | undefined): TimingPoint[] {
  return (lyrics?.lines ?? []).map((l) => ({ key: key(l.text), start: typeof l.start === "number" && Number.isFinite(l.start) ? Math.round(l.start * 1000) / 1000 : null }));
}

/**
 * Lines of `lyrics` whose start differs from the same line in `baseline` by more than
 * TIMING_CHANGE_SECONDS (or that were untimed there and are timed now). Lines are matched by
 * text, in order, so edits that insert or remove lines do not count as timing changes.
 */
export function compareTiming(baseline: readonly TimingPoint[], lyrics: Lyrics | null | undefined): { lines: number; shift: number } {
  const now = timingSnapshot(lyrics);
  let j = 0;
  let lines = 0;
  let shift = 0;
  for (const p of now) {
    let k = -1;
    for (let m = j; m < Math.min(baseline.length, j + LOOKAHEAD); m++) {
      if (baseline[m].key === p.key) {
        k = m;
        break;
      }
    }
    if (k < 0) continue;
    j = k + 1;
    const before = baseline[k].start;
    if (p.start == null) continue;
    const d = before == null ? Infinity : Math.abs(p.start - before);
    if (d > TIMING_CHANGE_SECONDS) {
      lines++;
      if (Number.isFinite(d)) shift = Math.max(shift, d);
    }
  }
  return { lines, shift: Math.round(shift * 10) / 10 };
}

/**
 * The project's timing change after a lyrics save: measured against the timing the plan was designed
 * with (`previous.baseline`, or the lyrics before this save for a plan made before round 19). The
 * baseline is kept even when nothing moved yet (`lines` 0), so small edits add up across saves.
 */
export function nextTimingChange(previous: TimingChange | undefined, before: Lyrics, after: Lyrics, at: string): TimingChange {
  const baseline = previous?.baseline ?? timingSnapshot(before);
  const { lines, shift } = compareTiming(baseline, after);
  return { baseline, lines, shift, at };
}

/** The plan no longer follows the lyric timing: suggest a re-design. */
export function timingChanged(change: TimingChange | null | undefined): change is TimingChange {
  return !!change && change.lines > 0;
}

/** The operator-facing detail line: 「12 句的時間移動超過 2 秒（最多 9.5 秒）…」 */
export function timingChangeDetail(change: Pick<TimingChange, "lines" | "shift">): string {
  const most = change.shift > 0 ? `（最多 ${change.shift.toFixed(1)} 秒）` : "";
  return `${change.lines} 句的時間移動超過 ${TIMING_CHANGE_SECONDS} 秒${most}，目前的段落、提示與字的安排還是照舊的時間。重新設計會依新的時間重新分段。`;
}
