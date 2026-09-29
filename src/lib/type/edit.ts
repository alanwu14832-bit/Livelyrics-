// The 排版 editor's operations on a type system (字體藝術), pure and deterministic so they are
// testable and replayable (undo / redo keeps whole snapshots). Song level: the voice (switching
// redraws every unlocked line in the new voice), the parameters, fonts, colour treatment,
// ornaments and 「重新生成全部構圖」; section level: recipe / orientation / size / motion overrides;
// line level: an `edit` on the line's generated hint (recipe, 換一個構圖 = another seed, tapped
// emphasis, orientation, motion word, entrance and exit, nudge / size / rotation, colour role),
// the lock that regeneration keeps, and 「重設為生成的」.

import { FONTS } from "../font-meta";
import type { FontId } from "../schema";
import type { LyricLine, SectionDesign, TypeColorRole, TypeColorTreatment, TypeEnterId, TypeExitId, TypeLine, TypeLineEdit, TypeOrientation, TypeOrnamentId, TypeParams, TypeRecipeId, TypeSection, TypeSystem, TypeVoiceId } from "../types";
import { findMotionWord } from "./motion-words";
import { normalizeTypeSystem } from "./normalize";
import { regenerateLines, textKey } from "./sequence";
import { VOICES, voiceFonts } from "./vocab";

export interface EditContext {
  lines: readonly LyricLine[];
  sections: readonly SectionDesign[];
  duration: number;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** A type system for a plan that has none (the 排版 page's 「建立字體語言」). */
export function createTypeSystem(voice: TypeVoiceId, ctx: EditContext, fonts?: { cjk?: FontId; latin?: FontId }): TypeSystem {
  const f = voiceFonts(voice, fonts ?? null);
  const v = VOICES[voice];
  return normalizeTypeSystem(
    { voice, params: v.params, color: v.color, fonts: f, weight: v.weight, ornaments: v.ornaments.filter((o) => o !== "seal"), seal: "", rationale: "", lines: [] },
    { lines: ctx.lines, sections: ctx.sections, duration: ctx.duration, voice, fonts: f, keepEdits: true },
  ).system;
}

function sequenceInput(ts: TypeSystem, ctx: EditContext) {
  return { lines: ctx.lines, sections: ctx.sections, duration: ctx.duration, voice: ts.voice, params: ts.params };
}

/** 「重新生成全部構圖」: every unlocked line drawn again (its edit dropped); locked lines stay as they are. */
export function regenerateAll(ts: TypeSystem, ctx: EditContext): TypeSystem {
  const generation = (ts.generation ?? 0) + 1;
  return { ...ts, generation, lines: regenerateLines(sequenceInput(ts, ctx), ts.lines, generation) };
}

/**
 * Switch the voice: its parameters, colour treatment, weight and ornaments, the fonts when the
 * current ones do not speak it, and every unlocked line redrawn in its recipes (locked lines keep
 * theirs). The seal stays when the new voice is ink.
 */
export function setVoice(ts: TypeSystem, voice: TypeVoiceId, ctx: EditContext): TypeSystem {
  if (voice === ts.voice) return ts;
  const v = VOICES[voice];
  const next: TypeSystem = {
    ...ts,
    voice,
    params: { ...v.params },
    color: v.color,
    weight: v.weight,
    ornaments: v.ornaments.filter((o) => o !== "seal" || !!ts.seal),
    fonts: voiceFonts(voice, ts.fonts),
  };
  return regenerateAll(next, ctx);
}

export function setParam(ts: TypeSystem, key: keyof TypeParams, value: number): TypeSystem {
  const v = key === "gridColumns" ? Math.round(clamp(value, 2, 12)) : r2(clamp(value, 0, 1));
  if (ts.params[key] === v) return ts;
  return { ...ts, params: { ...ts.params, [key]: v } };
}

export function setFonts(ts: TypeSystem, fonts: { cjk?: FontId; latin?: FontId }): TypeSystem {
  const cjk = fonts.cjk && FONTS[fonts.cjk]?.cjk ? fonts.cjk : ts.fonts.cjk;
  const latin = fonts.latin && FONTS[fonts.latin] && !FONTS[fonts.latin].cjk ? fonts.latin : ts.fonts.latin;
  if (cjk === ts.fonts.cjk && latin === ts.fonts.latin) return ts;
  return { ...ts, fonts: { cjk, latin } };
}

export function setWeight(ts: TypeSystem, weight: number): TypeSystem {
  const w = Math.round(clamp(weight, 600, 900) / 100) * 100;
  return w === ts.weight ? ts : { ...ts, weight: w };
}

export function setColorTreatment(ts: TypeSystem, color: TypeColorTreatment): TypeSystem {
  return color === ts.color ? ts : { ...ts, color };
}

export function toggleOrnament(ts: TypeSystem, id: TypeOrnamentId): TypeSystem {
  const has = ts.ornaments.includes(id);
  return { ...ts, ornaments: has ? ts.ornaments.filter((o) => o !== id) : [...ts.ornaments, id] };
}

export function setSeal(ts: TypeSystem, seal: string): TypeSystem {
  const s = [...String(seal ?? "").replace(/\s+/g, "")].filter((ch) => /[\p{Script=Han}A-Za-z0-9]/u.test(ch)).slice(0, 4).join("");
  if (s === ts.seal) return ts;
  const ornaments = s && !ts.ornaments.includes("seal") && ts.voice === "ink" ? [...ts.ornaments, "seal" as const] : ts.ornaments;
  return { ...ts, seal: s, ornaments };
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

export type SectionPatch = Partial<Omit<TypeSection, "sectionId">>;

/** Merge a section override (null / undefined fields = follow the lines); an empty override is removed. */
export function setSection(ts: TypeSystem, sectionId: string, patch: SectionPatch): TypeSystem {
  const list = [...(ts.sections ?? [])];
  const i = list.findIndex((s) => s.sectionId === sectionId);
  const merged: TypeSection = { ...(i >= 0 ? list[i] : { sectionId }), ...patch };
  for (const k of Object.keys(merged) as Array<keyof TypeSection>) if (k !== "sectionId" && (merged[k] == null || (k === "scale" && merged[k] === 1))) delete merged[k];
  if (merged.scale != null) merged.scale = r2(clamp(merged.scale, 0.6, 1.6));
  if (merged.motion != null) merged.motion = r2(clamp(merged.motion, 0, 1));
  const empty = Object.keys(merged).length <= 1;
  if (i >= 0) {
    if (empty) list.splice(i, 1);
    else list[i] = merged;
  } else if (!empty) list.push(merged);
  const next: TypeSystem = { ...ts };
  if (list.length) next.sections = list;
  else delete next.sections;
  return next;
}

export function sectionOverride(ts: TypeSystem, sectionId: string | null | undefined): TypeSection | null {
  return (ts.sections ?? []).find((s) => s.sectionId === sectionId) ?? null;
}

// ---------------------------------------------------------------------------
// lines
// ---------------------------------------------------------------------------

/** The stored hint of a line (null when the line has none: it is composed by the rules). */
export function lineHint(ts: TypeSystem, lineId: string): TypeLine | null {
  return ts.lines.find((l) => l.lineId === lineId) ?? null;
}

/** The index in `lines` of the first line with the same lyric (a repeat follows it). */
export function firstOccurrence(lines: readonly LyricLine[], index: number): number {
  const key = textKey(lines[index]?.text ?? "");
  if (!key) return index;
  const at = lines.findIndex((l) => textKey(l.text) === key);
  return at >= 0 ? at : index;
}

/** How many times this lyric is sung. */
export function repeatCount(lines: readonly LyricLine[], index: number): number {
  const key = textKey(lines[index]?.text ?? "");
  return key ? lines.filter((l) => textKey(l.text) === key).length : 1;
}

function withLine(ts: TypeSystem, lineId: string, ctx: EditContext, change: (l: TypeLine) => TypeLine): TypeSystem {
  const i = ts.lines.findIndex((l) => l.lineId === lineId);
  let base: TypeLine | null = i >= 0 ? ts.lines[i] : null;
  if (!base) {
    // a line without a hint (added after the design, or a repeat): start from the rules' hint so
    // the edit sits on the composition the stage shows
    const line = ctx.lines.find((l) => l.id === lineId);
    if (!line || !line.text.trim()) return ts;
    const first = ctx.lines[firstOccurrence(ctx.lines, ctx.lines.indexOf(line))];
    const src = first && first.id !== lineId ? ts.lines.find((l) => l.lineId === first.id) : null;
    base = src ? { ...src, lineId, edit: null, locked: undefined } : { lineId, recipe: "title-card", emphasis: [], orientation: "h", energy: 0.4, motionWord: findMotionWord(line.text), seed: 0 };
    delete base.locked;
    if (!src) {
      // the rules decide (a fresh draw for this line alone)
      const drawn = normalizeTypeSystem({ ...ts, lines: ts.lines }, { lines: ctx.lines, sections: ctx.sections, duration: ctx.duration, voice: ts.voice, keepEdits: true }).system.lines.find((l) => l.lineId === lineId);
      if (drawn) base = { ...drawn, edit: null };
    }
  }
  const next = change(base);
  if (next === base && i >= 0) return ts;
  const lines = [...ts.lines];
  if (i >= 0) lines[i] = next;
  else {
    // keep lyric order
    const order = new Map(ctx.lines.map((l, k) => [l.id, k] as const));
    const at = lines.findIndex((l) => (order.get(l.lineId) ?? 0) > (order.get(lineId) ?? 0));
    if (at < 0) lines.push(next);
    else lines.splice(at, 0, next);
  }
  return { ...ts, lines };
}

function cleanEdit(e: TypeLineEdit): TypeLineEdit | null {
  const out: TypeLineEdit = {};
  for (const [k, v] of Object.entries(e) as Array<[keyof TypeLineEdit, unknown]>) {
    if (v === undefined || v === null) continue;
    if ((k === "dx" || k === "dy" || k === "rotate") && v === 0) continue;
    if (k === "scale" && v === 1) continue;
    if ((k === "enter" || k === "exit") && v === "auto") continue;
    if (k === "color" && v === "ink") continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Merge `patch` into a line's edit (undefined fields removed = back to the generated value). A
 * repeat that follows its first occurrence starts from that occurrence's edit, so changing one
 * detail of the third chorus keeps the nudge every chorus shares.
 */
export function editLine(ts: TypeSystem, lineId: string, patch: Partial<Record<keyof TypeLineEdit, unknown>>, ctx: EditContext): TypeSystem {
  const index = ctx.lines.findIndex((l) => l.id === lineId);
  const firstIdx = index >= 0 ? firstOccurrence(ctx.lines, index) : index;
  const inherited = firstIdx >= 0 && firstIdx !== index ? (lineHint(ts, ctx.lines[firstIdx].id)?.edit ?? null) : null;
  return withLine(ts, lineId, ctx, (l) => {
    const merged = { ...(l.edit ?? inherited ?? {}) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const edit = cleanEdit(merged as TypeLineEdit);
    const next: TypeLine = { ...l };
    if (edit) next.edit = edit;
    else delete next.edit;
    return next;
  });
}

export function setRecipe(ts: TypeSystem, lineId: string, recipe: TypeRecipeId | null, ctx: EditContext): TypeSystem {
  return editLine(ts, lineId, { recipe: recipe ?? undefined }, ctx);
}

/** The seed a line shows now (its edit's, else its hint's). */
export function currentSeed(ts: TypeSystem, lineId: string): number {
  const l = lineHint(ts, lineId);
  return l?.edit?.seed ?? l?.seed ?? 0;
}

/** 「換一個構圖」: the next seed in a fixed sequence (every press another composition, replayable). */
export function reroll(ts: TypeSystem, lineId: string, ctx: EditContext): TypeSystem {
  const seed = currentSeed(ts, lineId);
  const next = (seed * 48271 + 7919) % 99991;
  return editLine(ts, lineId, { seed: next === seed ? (seed + 1) % 99991 : next }, ctx);
}

/**
 * The tappable units of a line: CJK characters one by one, Latin words whole (punctuation and
 * spaces are not tappable). `from` / `to` are code-unit offsets into the text.
 */
export interface TapUnit {
  text: string;
  from: number;
  to: number;
}

export function tapUnits(text: string): TapUnit[] {
  const out: TapUnit[] = [];
  const re = /[A-Za-z0-9'’]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  for (const m of String(text ?? "").matchAll(re)) out.push({ text: m[0], from: m.index ?? 0, to: (m.index ?? 0) + m[0].length });
  return out;
}

/** Which tap units the emphasis covers (every occurrence of each emphasized substring). */
export function emphasizedUnits(text: string, emphasis: readonly string[]): boolean[] {
  const units = tapUnits(text);
  const on = units.map(() => false);
  for (const e of emphasis) {
    if (!e) continue;
    let at = text.indexOf(e);
    while (at >= 0) {
      const end = at + e.length;
      units.forEach((u, i) => {
        if (u.from >= at && u.to <= end) on[i] = true;
      });
      at = text.indexOf(e, end);
    }
  }
  return on;
}

/** Emphasis substrings from selected tap units: consecutive units (adjacent in the text) join into one phrase. */
export function emphasisFromUnits(text: string, selected: readonly boolean[], max = 4): string[] {
  const units = tapUnits(text);
  const out: string[] = [];
  let start = -1;
  let end = -1;
  const flush = () => {
    if (start >= 0) {
      const s = text.slice(start, end).trim();
      if (s && !out.includes(s)) out.push(s);
    }
    start = -1;
  };
  units.forEach((u, i) => {
    if (!selected[i]) {
      flush();
      return;
    }
    // CJK characters join when they touch; Latin words join across one space
    if (start >= 0 && u.from > end && !/^\s$/.test(text.slice(end, u.from))) flush();
    if (start < 0) start = u.from;
    end = u.to;
  });
  flush();
  return out.slice(0, max);
}

/** Tap one unit: toggles it in the line's emphasis (an edit; the rest of the emphasis is kept). */
export function toggleEmphasisUnit(ts: TypeSystem, lineId: string, unitIndex: number, current: readonly string[], ctx: EditContext): TypeSystem {
  const line = ctx.lines.find((l) => l.id === lineId);
  if (!line) return ts;
  const on = emphasizedUnits(line.text, current);
  if (unitIndex < 0 || unitIndex >= on.length) return ts;
  on[unitIndex] = !on[unitIndex];
  return editLine(ts, lineId, { emphasis: emphasisFromUnits(line.text, on) }, ctx);
}

export function setOrientation(ts: TypeSystem, lineId: string, o: TypeOrientation | null, ctx: EditContext): TypeSystem {
  return editLine(ts, lineId, { orientation: o ?? undefined }, ctx);
}

/** The motion word: a word of the line, "" = no motion, null = automatic (the rules' word). */
export function setMotionWord(ts: TypeSystem, lineId: string, word: string | null, ctx: EditContext): TypeSystem {
  return editLine(ts, lineId, { motionWord: word ?? undefined }, ctx);
}

export function setEnter(ts: TypeSystem, lineId: string, enter: TypeEnterId, ctx: EditContext): TypeSystem {
  return editLine(ts, lineId, { enter: enter === "auto" ? undefined : enter }, ctx);
}

export function setExit(ts: TypeSystem, lineId: string, exit: TypeExitId, ctx: EditContext): TypeSystem {
  return editLine(ts, lineId, { exit: exit === "auto" ? undefined : exit }, ctx);
}

/** The line's colour role; "auto" = what the song's colour treatment gives it. */
export function setColorRole(ts: TypeSystem, lineId: string, color: TypeColorRole | "auto", ctx: EditContext): TypeSystem {
  return editLine(ts, lineId, { color: color === "auto" ? undefined : color }, ctx);
}

/** Move the composition (fractions of the canvas width / height, clamped to ±0.5). */
export function nudgeTo(ts: TypeSystem, lineId: string, dx: number, dy: number, ctx: EditContext): TypeSystem {
  return editLine(ts, lineId, { dx: r4(clamp(dx, -0.5, 0.5)) || undefined, dy: r4(clamp(dy, -0.5, 0.5)) || undefined }, ctx);
}

export function setScale(ts: TypeSystem, lineId: string, scale: number, ctx: EditContext): TypeSystem {
  const s = r2(clamp(scale, 0.5, 2));
  return editLine(ts, lineId, { scale: s === 1 ? undefined : s }, ctx);
}

export function setRotate(ts: TypeSystem, lineId: string, deg: number, ctx: EditContext): TypeSystem {
  const d = Math.round(clamp(deg, -30, 30) * 10) / 10;
  return editLine(ts, lineId, { rotate: d === 0 ? undefined : d }, ctx);
}

/** 鎖定: 「重新生成全部構圖」 keeps the line (and its edit) as it is. */
export function setLocked(ts: TypeSystem, lineId: string, locked: boolean, ctx: EditContext): TypeSystem {
  return withLine(ts, lineId, ctx, (l) => {
    if (!!l.locked === locked) return l;
    const next: TypeLine = { ...l };
    if (locked) next.locked = true;
    else delete next.locked;
    return next;
  });
}

/** 「重設為生成的」: the line's edit dropped (its lock kept). */
export function resetLine(ts: TypeSystem, lineId: string): TypeSystem {
  const i = ts.lines.findIndex((l) => l.lineId === lineId);
  if (i < 0 || !ts.lines[i].edit) return ts;
  const lines = [...ts.lines];
  const next: TypeLine = { ...lines[i] };
  delete next.edit;
  lines[i] = next;
  return { ...ts, lines };
}

/** The system as generated: no line edits, no section overrides (the A/B comparison). */
export function generatedVersion(ts: TypeSystem): TypeSystem {
  const lines = ts.lines.map((l) => {
    if (!l.edit) return l;
    const copy: TypeLine = { ...l };
    delete copy.edit;
    return copy;
  });
  const next: TypeSystem = { ...ts, lines };
  delete next.sections;
  return next;
}

/** A line has editor changes. */
export function isEdited(ts: TypeSystem, lineId: string): boolean {
  const l = lineHint(ts, lineId);
  return !!l?.edit && Object.keys(l.edit).length > 0;
}

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

export interface EditorHistory {
  present: TypeSystem;
  past: TypeSystem[];
  future: TypeSystem[];
  /** the last edit's coalescing key (a slider drag or a nudge drag is one undo step) */
  mergeKey: string | null;
}

export const MAX_HISTORY = 120;

export function historyOf(ts: TypeSystem): EditorHistory {
  return { present: ts, past: [], future: [], mergeKey: null };
}

/** Apply a change; `merge` coalesces consecutive changes with the same key into one undo step. */
export function commit(h: EditorHistory, next: TypeSystem, merge: string | null = null): EditorHistory {
  if (next === h.present) return h;
  if (merge && merge === h.mergeKey && h.past.length) return { present: next, past: h.past, future: [], mergeKey: merge };
  return { present: next, past: [...h.past, h.present].slice(-MAX_HISTORY), future: [], mergeKey: merge };
}

export function undo(h: EditorHistory): EditorHistory {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { present: prev, past: h.past.slice(0, -1), future: [h.present, ...h.future].slice(0, MAX_HISTORY), mergeKey: null };
}

export function redo(h: EditorHistory): EditorHistory {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { present: next, past: [...h.past, h.present].slice(-MAX_HISTORY), future: rest, mergeKey: null };
}
