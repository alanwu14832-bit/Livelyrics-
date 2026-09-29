// From a stored plan to what one line looks like: the song's system (repaired, so any stored
// value renders) and the line's effective hint — its own generated hint, or the first occurrence
// of the same lyric (a chorus repeat looks the same, so the crowd recognizes it; the last chorus
// escalates), a section override from the editor, then the editor's edit on the line. Lines the
// hints do not cover (added in the lyrics editor later) get a deterministic automatic hint.

import { FONTS } from "../font-meta";
import { TYPE_COLOR_ROLES, TYPE_COLOR_TREATMENTS, TYPE_ENTER_IDS, TYPE_EXIT_IDS, TYPE_ORIENTATIONS, TYPE_ORNAMENT_IDS, TYPE_RECIPE_IDS, TYPE_VOICE_IDS } from "../schema";
import { sectionIndexForLine } from "../timeline";
import type { DesignPlan, LyricLine, TypeLine, TypeParams, TypeSystem } from "../types";
import type { LineContext, ResolvedHint, ResolvedTypeSystem } from "./model";
import { findMotionWord } from "./motion-words";
import { autoHint, textKey } from "./sequence";
import { VOICES } from "./vocab";
import type { StageOverrides } from "../stage/protocol";

const clamp = (x: unknown, lo: number, hi: number, fallback: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);
const oneOf = <T extends string>(x: unknown, list: readonly T[], fallback: T): T => (typeof x === "string" && (list as readonly string[]).includes(x) ? (x as T) : fallback);

/** A plan with a type system renders every line as a composition (unless the operator forces a legacy style). */
export function hasTypeSystem(plan: DesignPlan | null | undefined): plan is DesignPlan & { typeSystem: TypeSystem } {
  const ts = plan?.typeSystem;
  return !!ts && typeof ts === "object" && Array.isArray(ts.lines) && (TYPE_VOICE_IDS as readonly string[]).includes(ts.voice);
}

/** The type engine draws the lyrics (else the legacy DOM lyric layer does). */
export function typeModeActive(plan: DesignPlan | null | undefined, overrides?: Pick<StageOverrides, "lyricStyle"> | null): boolean {
  return hasTypeSystem(plan) && !overrides?.lyricStyle;
}

const systemCache = new WeakMap<object, ResolvedTypeSystem>();

export function resolveSystem(ts: TypeSystem): ResolvedTypeSystem {
  const hit = systemCache.get(ts);
  if (hit) return hit;
  const voice = oneOf(ts.voice, TYPE_VOICE_IDS, "mv-card");
  const d = VOICES[voice];
  const p = (ts.params ?? {}) as Partial<TypeParams>;
  const params: TypeParams = {
    scaleContrast: clamp(p.scaleContrast, 0, 1, d.params.scaleContrast),
    density: clamp(p.density, 0, 1, d.params.density),
    verticalRatio: clamp(p.verticalRatio, 0, 1, d.params.verticalRatio),
    gridColumns: Math.round(clamp(p.gridColumns, 2, 12, d.params.gridColumns)),
    gridMargin: clamp(p.gridMargin, 0, 1, d.params.gridMargin),
    motionSpeed: clamp(p.motionSpeed, 0, 1, d.params.motionSpeed),
    motionIntensity: clamp(p.motionIntensity, 0, 1, d.params.motionIntensity),
    texture: clamp(p.texture, 0, 1, d.params.texture),
    ornament: clamp(p.ornament, 0, 1, d.params.ornament),
  };
  const cjk = ts.fonts?.cjk && FONTS[ts.fonts.cjk]?.cjk ? ts.fonts.cjk : d.fonts.cjk;
  const latin = ts.fonts?.latin && FONTS[ts.fonts.latin] && !FONTS[ts.fonts.latin].cjk ? ts.fonts.latin : d.fonts.latin;
  const out: ResolvedTypeSystem = {
    voice,
    params,
    color: oneOf(ts.color, TYPE_COLOR_TREATMENTS, d.color),
    fonts: { cjk, latin },
    weight: Math.round(clamp(ts.weight, 600, 900, d.weight) / 100) * 100,
    ornaments: (Array.isArray(ts.ornaments) ? ts.ornaments : d.ornaments).filter((o, i, a): o is (typeof TYPE_ORNAMENT_IDS)[number] => (TYPE_ORNAMENT_IDS as readonly string[]).includes(o) && a.indexOf(o) === i),
    seal: typeof ts.seal === "string" ? [...ts.seal.replace(/\s+/g, "")].slice(0, 4).join("") : "",
  };
  systemCache.set(ts, out);
  return out;
}

interface LineTable {
  byId: Map<string, TypeLine>;
  /** first line index per text key */
  firstIndex: Map<string, number>;
  /** chorus sections in order, the last one's index */
  lastChorus: number | null;
  chorusKeys: Set<string>;
}

const tables = new WeakMap<object, { lines: readonly LyricLine[]; table: LineTable }>();

function lineTable(plan: DesignPlan & { typeSystem: TypeSystem }, lines: readonly LyricLine[], duration: number): LineTable {
  const cached = tables.get(plan.typeSystem);
  if (cached && cached.lines === lines) return cached.table;
  const byId = new Map<string, TypeLine>();
  for (const l of plan.typeSystem.lines) if (l && typeof l.lineId === "string" && !byId.has(l.lineId)) byId.set(l.lineId, l);
  const firstIndex = new Map<string, number>();
  lines.forEach((l, i) => {
    const k = textKey(l.text);
    if (k && !firstIndex.has(k)) firstIndex.set(k, i);
  });
  let lastChorus: number | null = null;
  let chorusCount = 0;
  plan.sections.forEach((s, i) => {
    if (s.kind === "chorus") {
      lastChorus = i;
      chorusCount++;
    }
  });
  if (chorusCount < 2) lastChorus = null;
  const chorusKeys = new Set<string>();
  lines.forEach((l, i) => {
    const si = sectionIndexForLine(plan, lines as LyricLine[], i, duration);
    if (si != null && plan.sections[si]?.kind === "chorus" && si !== lastChorus) chorusKeys.add(textKey(l.text));
  });
  const table = { byId, firstIndex, lastChorus, chorusKeys };
  tables.set(plan.typeSystem, { lines, table });
  return table;
}

function validSubstrings(list: unknown, text: string): string[] {
  const out: string[] = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (typeof e !== "string") continue;
    const w = e.trim();
    if (w && text.includes(w) && !out.includes(w)) out.push(w);
  }
  return out.slice(0, 4);
}

export interface LineResolution {
  hint: ResolvedHint;
  ctx: LineContext;
  /** the stored hint this line uses (its own, or the first occurrence's for a repeat) */
  source: TypeLine | null;
  /** the line index whose hint is used (a repeat points at its first occurrence) */
  sourceIndex: number;
}

export interface ResolveOptions {
  duration: number;
  songTitle?: string;
  /** ignore the editor's edits (the A/B comparison and 「重設為生成的」) */
  generated?: boolean;
}

/** The effective hint and context of line `index`; null for an empty or missing line. */
export function resolveLine(plan: DesignPlan & { typeSystem: TypeSystem }, lines: readonly LyricLine[], index: number, opts: ResolveOptions): LineResolution | null {
  const line = lines[index];
  if (!line || typeof line.text !== "string" || !line.text.trim()) return null;
  const ts = plan.typeSystem;
  const table = lineTable(plan, lines, opts.duration);
  const key = textKey(line.text);
  const firstIdx = table.firstIndex.get(key) ?? index;
  const own = table.byId.get(line.id) ?? null;
  const first = firstIdx !== index ? (table.byId.get(lines[firstIdx]?.id) ?? null) : null;
  // a repeat follows its first occurrence (base and edit) unless it was edited itself
  const ownEdited = !!own?.edit && Object.keys(own.edit).length > 0;
  const base = first && !ownEdited ? first : own;
  const sourceIndex = base === first && first ? firstIdx : index;
  const sectionIndex = sectionIndexForLine(plan, lines as LyricLine[], index, opts.duration);
  const section = sectionIndex != null ? plan.sections[sectionIndex] : undefined;
  const fallback = autoHint(line, index, { voice: resolveSystem(ts).voice, params: resolveSystem(ts).params, sectionKind: section?.kind ?? null, sectionEnergy: section?.energy ?? 0.5, salt: ts.generation ?? 0 });
  const src = base ?? fallback;
  const edit = opts.generated ? null : (ownEdited ? own!.edit : base?.edit) ?? null;
  const override = (ts.sections ?? []).find((s) => s && s.sectionId === section?.id) ?? null;
  const latin = !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(line.text);
  const recipe = oneOf(edit?.recipe, TYPE_RECIPE_IDS, oneOf(override?.recipe ?? undefined, TYPE_RECIPE_IDS, oneOf(src.recipe, TYPE_RECIPE_IDS, fallback.recipe)));
  let orientation = oneOf(edit?.orientation, TYPE_ORIENTATIONS, oneOf(override?.orientation ?? undefined, TYPE_ORIENTATIONS, oneOf(src.orientation, TYPE_ORIENTATIONS, "h")));
  if (latin) orientation = "h";
  const emphasis = validSubstrings(edit?.emphasis ?? src.emphasis, line.text);
  const mw = typeof (edit?.motionWord ?? src.motionWord) === "string" ? String(edit?.motionWord ?? src.motionWord).trim() : "";
  const motionWord = mw && line.text.includes(mw) ? mw : edit?.motionWord === "" ? "" : findMotionWord(line.text);
  const escalate = table.lastChorus != null && sectionIndex === table.lastChorus && table.chorusKeys.has(key);
  const energy = clamp(src.energy, 0, 1, fallback.energy);
  const hint: ResolvedHint = {
    recipe,
    emphasis,
    orientation,
    energy,
    motionWord,
    seed: Math.round(Math.abs(clamp(edit?.seed ?? src.seed, -1e9, 1e9, fallback.seed))),
    dx: clamp(edit?.dx, -0.5, 0.5, 0),
    dy: clamp(edit?.dy, -0.5, 0.5, 0),
    scale: clamp(edit?.scale, 0.5, 2, 1) * clamp(override?.scale ?? undefined, 0.6, 1.6, 1),
    rotate: clamp(edit?.rotate, -30, 30, 0),
    enter: oneOf(edit?.enter, TYPE_ENTER_IDS, "auto"),
    exit: oneOf(edit?.exit, TYPE_EXIT_IDS, "auto"),
    color: oneOf(edit?.color, TYPE_COLOR_ROLES, "ink"),
    escalate,
    motion: override?.motion != null ? clamp(override.motion, 0, 1, 0.5) : null,
  };
  // the first lyric line of its section carries the section's label and number
  let first0 = true;
  for (let j = index - 1; j >= 0; j--) {
    if (!lines[j]?.text?.trim()) continue;
    first0 = sectionIndexForLine(plan, lines as LyricLine[], j, opts.duration) !== sectionIndex;
    break;
  }
  const ctx: LineContext = {
    lineIndex: index,
    lineCount: lines.length,
    sectionIndex,
    sectionKind: section?.kind ?? null,
    sectionLabel: section?.label ?? "",
    songTitle: opts.songTitle ?? "",
    first: first0,
  };
  return { hint, ctx, source: base, sourceIndex };
}
