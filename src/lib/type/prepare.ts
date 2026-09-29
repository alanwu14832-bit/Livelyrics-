// One call from a stored plan + lyrics + canvas to a line's composition: prepare the line's text
// (the lyric layer's tokenizer, timing and emphasis), resolve its hint, compose it. The stage's
// type layer, the export, the 排版 editor's thumbnails and the tests all go through here.

import { prepareLine } from "../stage/lyrics/model";
import type { DesignPlan, LyricLine, TypeSystem } from "../types";
import { composeKey, composeLine } from "./compose";
import type { CanvasSpec, Composition, Measure } from "./model";
import { resolveLine, resolveSystem, type LineResolution } from "./resolve";
import { lineText, type LineText } from "./text";

export function prepareLineText(lines: readonly LyricLine[], index: number, emphasis: readonly string[], songDuration: number): LineText | null {
  const p = prepareLine(lines, index, { maxChars: 16, maxLines: 2, songDuration, emphasis });
  if (!p || !p.units.some((u) => u.kind === "cjk" || u.kind === "latin")) return null;
  return lineText(p.text, p.units, p.emphasis, p.translation);
}

export interface ComposeProjectOptions {
  duration: number;
  songTitle?: string;
  /** compose the generated version (no editor edits): the A/B comparison */
  generated?: boolean;
}

export interface ProjectLineComposition {
  comp: Composition;
  res: LineResolution;
  key: string;
}

/** The composition of line `index` of a plan with a type system (null for an empty line). */
export function composeProjectLine(plan: DesignPlan & { typeSystem: TypeSystem }, lines: readonly LyricLine[], index: number, canvas: CanvasSpec, measure: Measure, opts: ComposeProjectOptions): ProjectLineComposition | null {
  const res = resolveLine(plan, lines, index, { duration: opts.duration, songTitle: opts.songTitle, generated: opts.generated });
  if (!res) return null;
  const lt = prepareLineText(lines, index, res.hint.emphasis, opts.duration);
  if (!lt) return null;
  const system = resolveSystem(plan.typeSystem);
  const input = { lt, lineId: lines[index].id, hint: res.hint, system, canvas, ctx: res.ctx, measure };
  return { comp: composeLine(input), res, key: composeKey(input) };
}
