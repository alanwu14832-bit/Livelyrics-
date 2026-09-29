// normalizeTypeSystem: any (possibly partial or wrong) type system → a valid one for this song.
// Numbers clamped, enums checked, fonts in the right script, emphasis and motion words exact
// substrings of their line, unknown line ids and recipes dropped, and the hints that are missing
// filled in deterministically by the sequencer (so every line has a composition). Editor fields
// (locked, edit, section overrides) are kept when valid. Never throws; reports repairs in 繁中.

import { FONTS } from "../font-meta";
import {
  TYPE_COLOR_ROLES,
  TYPE_COLOR_TREATMENTS,
  TYPE_ENTER_IDS,
  TYPE_EXIT_IDS,
  TYPE_ORIENTATIONS,
  TYPE_ORNAMENT_IDS,
  TYPE_RECIPE_IDS,
  TYPE_VOICE_IDS,
  type FontId,
  type TypeLineEdit,
  type TypeOrnamentId,
  type TypeSection,
} from "../schema";
import type { LyricLine, SectionDesign, TypeLine, TypeParams, TypeSystem, TypeVoiceId } from "../types";
import { sequenceTypeLines, type SequenceInput } from "./sequence";
import { VOICES } from "./vocab";

type Obj = Record<string, unknown>;
const asObj = (x: unknown): Obj | null => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null);
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const r2 = (x: number) => Math.round(x * 100) / 100;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function oneOf<T extends string>(x: unknown, list: readonly T[]): T | null {
  if (typeof x !== "string") return null;
  const v = x.trim();
  if ((list as readonly string[]).includes(v)) return v as T;
  const lower = v.toLowerCase().replace(/[\s_]+/g, "-");
  return (list as readonly string[]).includes(lower) ? (lower as T) : null;
}

export interface TypeNormalizeContext {
  lines: readonly LyricLine[];
  sections: readonly SectionDesign[];
  duration: number;
  /** the voice to use when none is valid (the offline choice for this song) */
  voice: TypeVoiceId;
  /** fonts to fall back to (the plan's typography or the band's bible) */
  fonts?: { cjk?: FontId; latin?: FontId };
  /** hints the sequencer should use for missing lines */
  emphasisFor?: SequenceInput["emphasisFor"];
  motionFor?: SequenceInput["motionFor"];
  policy?: SequenceInput["policy"];
  hookKey?: string | null;
  /** keep editor-only fields (locked, edit, section overrides): storage paths do, design outputs do not */
  keepEdits?: boolean;
}

export interface TypeNormalizeReport {
  system: TypeSystem;
  repairs: string[];
}

function exactList(raw: unknown, text: string, max: number, bad: { n: number }): string[] {
  const out: string[] = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (typeof e !== "string") continue;
    const w = e.trim();
    if (!w) continue;
    let found: string | null = text.includes(w) ? w : null;
    if (!found) {
      const at = text.toLowerCase().indexOf(w.toLowerCase());
      if (at >= 0) found = text.slice(at, at + w.length);
    }
    if (!found) bad.n++;
    else if (!out.includes(found)) out.push(found);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeEdit(raw: unknown, text: string): TypeLineEdit | null {
  const o = asObj(raw);
  if (!o) return null;
  const e: TypeLineEdit = {};
  const recipe = oneOf(o.recipe, TYPE_RECIPE_IDS);
  if (recipe) e.recipe = recipe;
  if (Array.isArray(o.emphasis)) e.emphasis = exactList(o.emphasis, text, 4, { n: 0 });
  const orientation = oneOf(o.orientation, TYPE_ORIENTATIONS);
  if (orientation) e.orientation = orientation;
  if (typeof o.motionWord === "string") {
    const w = o.motionWord.trim();
    if (!w || text.includes(w)) e.motionWord = w;
  }
  const seed = num(o.seed);
  if (seed != null) e.seed = Math.round(Math.abs(seed)) % 100000;
  const dx = num(o.dx);
  if (dx != null && dx !== 0) e.dx = Math.round(clamp(dx, -0.5, 0.5) * 10000) / 10000;
  const dy = num(o.dy);
  if (dy != null && dy !== 0) e.dy = Math.round(clamp(dy, -0.5, 0.5) * 10000) / 10000;
  const scale = num(o.scale);
  if (scale != null && scale !== 1) e.scale = r2(clamp(scale, 0.5, 2));
  const rotate = num(o.rotate);
  if (rotate != null && rotate !== 0) e.rotate = Math.round(clamp(rotate, -30, 30) * 10) / 10;
  const enter = oneOf(o.enter, TYPE_ENTER_IDS);
  if (enter && enter !== "auto") e.enter = enter;
  const exit = oneOf(o.exit, TYPE_EXIT_IDS);
  if (exit && exit !== "auto") e.exit = exit;
  const color = oneOf(o.color, TYPE_COLOR_ROLES);
  if (color && color !== "ink") e.color = color;
  return Object.keys(e).length ? e : null;
}

/** Normalize a type system for this song (null / garbage in → the song's rule-based system). */
export function normalizeTypeSystem(raw: unknown, c: TypeNormalizeContext): TypeNormalizeReport {
  const repairs: string[] = [];
  const o = asObj(raw) ?? {};
  const given = asObj(raw) != null;
  const voice = oneOf(o.voice, TYPE_VOICE_IDS) ?? c.voice;
  if (given && voice !== o.voice) repairs.push("字體語言不在清單中，改用這首歌的預設");
  const d = VOICES[voice];
  const p = asObj(o.params) ?? {};
  const unit = (k: keyof TypeParams) => {
    const v = num(p[k]);
    return v == null ? d.params[k] : r2(clamp(v, 0, 1));
  };
  const cols = num(p.gridColumns);
  const params: TypeParams = {
    scaleContrast: unit("scaleContrast"),
    density: unit("density"),
    verticalRatio: unit("verticalRatio"),
    gridColumns: cols == null ? d.params.gridColumns : Math.round(clamp(cols, 2, 12)),
    gridMargin: unit("gridMargin"),
    motionSpeed: unit("motionSpeed"),
    motionIntensity: unit("motionIntensity"),
    texture: unit("texture"),
    ornament: unit("ornament"),
  };
  const f = asObj(o.fonts) ?? {};
  const cjkIn = oneOf(f.cjk, Object.keys(FONTS) as FontId[]);
  const latinIn = oneOf(f.latin, Object.keys(FONTS) as FontId[]);
  const cjkFallback = c.fonts?.cjk && FONTS[c.fonts.cjk]?.cjk ? c.fonts.cjk : d.fonts.cjk;
  const latinFallback = c.fonts?.latin && FONTS[c.fonts.latin] && !FONTS[c.fonts.latin].cjk ? c.fonts.latin : d.fonts.latin;
  const cjk = cjkIn && FONTS[cjkIn].cjk ? cjkIn : cjkFallback;
  const latin = latinIn && !FONTS[latinIn].cjk ? latinIn : latinFallback;
  if (given && (cjk !== f.cjk || latin !== f.latin)) repairs.push("修正字體語言的字體配對（中文字需用 CJK 字體）");
  const w = num(o.weight);
  const weight = Math.round(clamp(w ?? d.weight, 600, 900) / 100) * 100;
  if (given && w != null && w < 600) repairs.push("字體語言的字重提高到 600（大螢幕可讀性）");
  const ornaments = (Array.isArray(o.ornaments) ? o.ornaments : given ? [] : d.ornaments).map((x) => oneOf(x, TYPE_ORNAMENT_IDS)).filter((x, i, a): x is TypeOrnamentId => x != null && a.indexOf(x) === i);
  const seal = typeof o.seal === "string" ? [...o.seal.replace(/\s+/g, "")].filter((ch) => CJK_RE.test(ch) || /[A-Za-z0-9]/.test(ch)).slice(0, 4).join("") : "";
  const rationale = typeof o.rationale === "string" ? o.rationale.replace(/\s+/g, " ").trim().slice(0, 300) : "";

  // the lines: valid hints kept (first per id), the rest drawn by the sequencer
  const byId = new Map(c.lines.map((l) => [l.id, l] as const));
  const keep = new Map<string, TypeLine>();
  let unknown = 0;
  let badRecipe = 0;
  const badEmphasis = { n: 0 };
  for (const item of Array.isArray(o.lines) ? o.lines : []) {
    const l = asObj(item);
    const id = typeof l?.lineId === "string" ? l.lineId.trim() : "";
    const line = byId.get(id);
    if (!l || !line || !line.text.trim()) {
      unknown++;
      continue;
    }
    if (keep.has(id)) continue;
    const recipe = oneOf(l.recipe, TYPE_RECIPE_IDS);
    if (!recipe) {
      badRecipe++;
      continue;
    }
    const latinOnly = !CJK_RE.test(line.text);
    let orientation = oneOf(l.orientation, TYPE_ORIENTATIONS) ?? "h";
    if (latinOnly) orientation = "h";
    const mw = typeof l.motionWord === "string" ? l.motionWord.trim() : "";
    const seed = num(l.seed);
    const energy = num(l.energy);
    const hint: TypeLine = {
      lineId: id,
      recipe,
      emphasis: exactList(l.emphasis, line.text, 2, badEmphasis),
      orientation,
      energy: r2(clamp(energy ?? 0.5, 0, 1)),
      motionWord: mw && line.text.includes(mw) ? mw : "",
      seed: seed == null ? 0 : Math.round(Math.abs(seed)) % 100000,
    };
    if (c.keepEdits) {
      if (l.locked === true) hint.locked = true;
      const edit = normalizeEdit(l.edit, line.text);
      if (edit) hint.edit = edit;
    }
    keep.set(id, hint);
  }
  if (unknown) repairs.push(`略過 ${unknown} 個不存在的歌詞行構圖`);
  if (badRecipe) repairs.push(`有 ${badRecipe} 行的構圖不在清單中，已重新安排`);
  if (badEmphasis.n) repairs.push(`略過 ${badEmphasis.n} 個不在歌詞中的構圖強調字`);
  const sung = c.lines.filter((l) => l.text.trim());
  const missing = sung.filter((l) => !keep.has(l.id)).length;
  const lines = sequenceTypeLines({
    lines: c.lines,
    sections: c.sections,
    duration: c.duration,
    voice,
    params,
    keep,
    emphasisFor: c.emphasisFor,
    motionFor: c.motionFor,
    policy: c.policy,
    hookKey: c.hookKey,
  });
  if (missing && given && keep.size) repairs.push(`補上 ${missing} 行歌詞的構圖（重複句沿用同一個構圖）`);

  const system: TypeSystem = { voice, params, color: oneOf(o.color, TYPE_COLOR_TREATMENTS) ?? d.color, fonts: { cjk, latin }, weight, ornaments, seal, rationale, lines };
  if (c.keepEdits) {
    const ids = new Set(c.sections.map((s) => s.id));
    const sections: TypeSection[] = [];
    for (const item of Array.isArray(o.sections) ? o.sections : []) {
      const s = asObj(item);
      if (!s || typeof s.sectionId !== "string" || !ids.has(s.sectionId) || sections.some((x) => x.sectionId === s.sectionId)) continue;
      const out: TypeSection = { sectionId: s.sectionId };
      const recipe = oneOf(s.recipe, TYPE_RECIPE_IDS);
      if (recipe) out.recipe = recipe;
      const orientation = oneOf(s.orientation, TYPE_ORIENTATIONS);
      if (orientation) out.orientation = orientation;
      const scale = num(s.scale);
      if (scale != null && scale !== 1) out.scale = r2(clamp(scale, 0.6, 1.6));
      const motion = num(s.motion);
      if (motion != null) out.motion = r2(clamp(motion, 0, 1));
      if (Object.keys(out).length > 1) sections.push(out);
    }
    if (sections.length) system.sections = sections;
    const gen = num(o.generation);
    if (gen != null && gen > 0) system.generation = Math.round(gen);
  }
  return { system, repairs };
}
