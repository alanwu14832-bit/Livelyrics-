// CJK-aware lyric row breaking for big screens.
// Rules (Netflix TC timed-text guide + stage practice, see reports/音樂祭大螢幕歌詞與視覺設計.md):
//   - at most `maxLines` rows (default 2), ≈16 CJK chars per row,
//   - prefer breaking at spaces, then after punctuation, then at script changes,
//   - never break inside a Latin word, never start a row with closing punctuation,
//     never end a row with opening punctuation,
//   - balanced rows with a slightly lighter top row (下重上輕),
//   - soft punctuation at the end of a row is dropped (行尾不放「、，。」).
// Anything that still doesn't fit is scaled down by the renderer (fit-to-safe-area).

import {
  DROP_AT_ROW_END,
  NO_LINE_END,
  NO_LINE_START,
  textWidth,
  tokenizeLyric,
  type TextUnit,
} from "./tokenize";

export interface BreakOptions {
  /** max CJK-char widths per row (default 16) */
  maxChars?: number;
  /** max rows (default 2) */
  maxLines?: number;
}

/** Unbreakable groups of unit indices (punctuation glued to its neighbour). */
function buildAtoms(units: TextUnit[]): number[][] {
  const atoms: number[][] = [];
  let pendingOpen: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.kind === "punct" && NO_LINE_END.has(u.text)) {
      pendingOpen.push(i);
      continue;
    }
    const glueToPrev =
      atoms.length > 0 &&
      pendingOpen.length === 0 &&
      u.kind === "punct" &&
      (NO_LINE_START.has(u.text) || isRepeatOfPrevPunct(units, i));
    if (glueToPrev) {
      atoms[atoms.length - 1].push(i);
      continue;
    }
    atoms.push([...pendingOpen, i]);
    pendingOpen = [];
  }
  if (pendingOpen.length) {
    if (atoms.length) atoms[atoms.length - 1].push(...pendingOpen);
    else atoms.push(pendingOpen);
  }
  return atoms;
}

function isRepeatOfPrevPunct(units: TextUnit[], i: number): boolean {
  const prev = units[i - 1];
  return !!prev && prev.kind === "punct" && prev.text === units[i].text;
}

/** Remove leading/trailing spaces and trailing soft punctuation from a row. */
export function trimRow(row: TextUnit[]): TextUnit[] {
  let start = 0;
  let end = row.length;
  while (start < end && row[start].kind === "space") start++;
  for (;;) {
    while (end > start && row[end - 1].kind === "space") end--;
    if (end > start && row[end - 1].kind === "punct" && DROP_AT_ROW_END.has(row[end - 1].text)) {
      end--;
      continue;
    }
    break;
  }
  return row.slice(start, end);
}

function breakBonus(before: TextUnit | undefined, after: TextUnit | undefined): number {
  if (!before || !after) return 0;
  if (before.kind === "space" || after.kind === "space") return -3.2;
  if (before.kind === "punct") return -2.6;
  if ((before.kind === "latin") !== (after.kind === "latin")) return -1.2;
  return 0;
}

/**
 * Break `units` into display rows. Returns rows of units (already trimmed).
 * Always returns at least one row (possibly empty) for non-empty input.
 */
export function breakUnits(units: TextUnit[], opts: BreakOptions = {}): TextUnit[][] {
  const maxChars = Math.max(2, opts.maxChars ?? 16);
  const maxLines = Math.max(1, Math.floor(opts.maxLines ?? 2));
  const whole = trimRow(units);
  if (whole.length === 0) return [];
  const total = textWidth(whole);
  if (total <= maxChars || maxLines === 1) return [whole];

  const atoms = buildAtoms(units);
  if (atoms.length < 2) return [whole];

  // Greedy-balanced multi-row split: choose break points one row at a time so each
  // row fits, scoring candidates by fit, balance and break quality.
  const rows: TextUnit[][] = [];
  let atomStart = 0;
  for (let row = 0; row < maxLines && atomStart < atoms.length; row++) {
    const remainingAtoms = atoms.slice(atomStart);
    const remainingUnits = remainingAtoms.flat().map((i) => units[i]);
    const remainingWidth = textWidth(trimRow(remainingUnits));
    const rowsLeft = maxLines - row;
    if (rowsLeft === 1 || remainingWidth <= maxChars) {
      rows.push(trimRow(remainingUnits));
      atomStart = atoms.length;
      break;
    }
    const rowsNeeded = Math.min(rowsLeft, Math.max(2, Math.ceil(remainingWidth / maxChars)));
    // top rows slightly lighter than the bottom (pyramid)
    const target = (remainingWidth / rowsNeeded) * (row === 0 ? 0.94 : 1);
    let best = -1;
    let bestCost = Infinity;
    for (let k = 1; k < remainingAtoms.length; k++) {
      const head = trimRow(remainingAtoms.slice(0, k).flat().map((i) => units[i]));
      const tail = trimRow(remainingAtoms.slice(k).flat().map((i) => units[i]));
      if (head.length === 0 || tail.length === 0) continue;
      const w1 = textWidth(head);
      const w2 = textWidth(tail);
      const restCapacity = maxChars * (rowsLeft - 1);
      let cost = Math.abs(w1 - target) * 1.0;
      cost += Math.max(0, w1 - maxChars) * 12;
      cost += Math.max(0, w2 - restCapacity) * 6;
      if (w1 < 2 || (rowsLeft === 2 && w2 < 2)) cost += 5; // orphans
      const before = units[remainingAtoms[k - 1][remainingAtoms[k - 1].length - 1]];
      const after = units[remainingAtoms[k][0]];
      cost += breakBonus(before, after);
      if (cost < bestCost) {
        bestCost = cost;
        best = k;
      }
    }
    if (best < 0) {
      rows.push(trimRow(remainingUnits));
      atomStart = atoms.length;
      break;
    }
    rows.push(trimRow(remainingAtoms.slice(0, best).flat().map((i) => units[i])));
    atomStart += best;
  }
  return rows.filter((r) => r.length > 0);
}

/** Convenience: break a text string into row strings. */
export function breakLyricText(text: string, opts: BreakOptions = {}): string[] {
  return breakUnits(tokenizeLyric(text), opts).map((row) => row.map((u) => u.text).join(""));
}
