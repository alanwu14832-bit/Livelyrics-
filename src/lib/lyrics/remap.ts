// Keep plan.lines[] pointing at the right lyric lines after the lyrics change.
//
// normalizeLyrics() re-numbers ids l0..lN in time order, so inserting, deleting or
// reordering lines in the editor shifts every id after the edit. A LineDesign (emphasis,
// per-line style override, note) belongs to a line's *text*, so it follows the line with
// the same text — the occurrence nearest to where the old line was — and is dropped when
// that text no longer exists.

import type { DesignPlan, LineDesign, Lyrics } from "@/lib/types";

function key(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Distance between an old line and a candidate new line: time when both are timed, else relative position. */
function distance(oldStart: number | null, oldPos: number, newStart: number | null, newPos: number): number {
  if (oldStart != null && newStart != null) return Math.abs(oldStart - newStart);
  // untimed on either side: 1000 s-equivalent per full-song shift keeps timed matches preferred
  return 1000 + Math.abs(oldPos - newPos) * 1000;
}

export interface RemapResult {
  lines: LineDesign[];
  /** line designs whose text no longer exists in the new lyrics */
  dropped: number;
  /** line designs that now point at a different id */
  moved: number;
}

export function remapLineDesigns(designs: readonly LineDesign[], before: Lyrics, after: Lyrics): RemapResult {
  const oldById = new Map(before.lines.map((l, i) => [l.id, { line: l, pos: before.lines.length > 1 ? i / (before.lines.length - 1) : 0 }]));
  const candidates = new Map<string, Array<{ id: string; start: number | null; pos: number }>>();
  after.lines.forEach((l, i) => {
    const k = key(l.text);
    if (!k) return;
    const list = candidates.get(k) ?? [];
    list.push({ id: l.id, start: l.start, pos: after.lines.length > 1 ? i / (after.lines.length - 1) : 0 });
    candidates.set(k, list);
  });

  const used = new Set<string>();
  const out: LineDesign[] = [];
  let dropped = 0;
  let moved = 0;
  for (const design of designs) {
    const old = oldById.get(design.lineId);
    const list = old ? candidates.get(key(old.line.text)) : undefined;
    let best: { id: string; d: number } | null = null;
    for (const c of list ?? []) {
      if (used.has(c.id)) continue;
      const d = distance(old!.line.start, old!.pos, c.start, c.pos);
      if (!best || d < best.d) best = { id: c.id, d };
    }
    if (!best) {
      dropped++;
      continue;
    }
    used.add(best.id);
    if (best.id !== design.lineId) moved++;
    out.push({ ...design, lineId: best.id });
  }
  return { lines: out, dropped, moved };
}

/** The plan with its line designs re-pointed at `after` (returns the same plan when nothing changed). */
export function remapPlanLines(plan: DesignPlan, before: Lyrics, after: Lyrics): DesignPlan {
  if (plan.lines.length === 0) return plan;
  const { lines, dropped, moved } = remapLineDesigns(plan.lines, before, after);
  if (dropped === 0 && moved === 0) return plan;
  return { ...plan, lines };
}
