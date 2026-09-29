// The sequencer: a composition hint for every lyric line, rule-based and deterministic. One
// coherent system per song (the voice's recipe palette, its grid and fonts); consecutive lines
// vary (another recipe, the other side of the frame); a repeated lyric reuses its first
// composition so the crowd recognizes the chorus, and the last chorus escalates it; verses are
// calmer, choruses bigger, the bridge contrasts, quiet lines whisper. Used by the offline / free
// designer, by normalizePlan to fill the hints Claude left out, and by the 排版 editor's
// 「重新生成全部構圖」 (locked lines are kept).

import { lineAnchor, sectionIndexAt } from "../timeline";
import type { LyricLine, SectionDesign, SectionKind, TypeLine, TypeOrientation, TypeParams, TypeRecipeId, TypeVoiceId } from "../types";
import { findMotionWord } from "./motion-words";
import { zoneFor } from "./recipes";
import { createRng, hash32 } from "./rng";
import { RECIPES, VOICES } from "./vocab";

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Repetition key: width- and case-folded letters and digits only (「Hey 跟著我唱」 = 「hey，跟著我唱」). */
export function textKey(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function units(text: string): number {
  let n = 0;
  for (const ch of text) if (CJK_RE.test(ch)) n++;
  n += (text.match(/[A-Za-z0-9']+/g) ?? []).length;
  return n;
}

/** Display recipes that carry a chorus; calm ones that suit verses. */
const LOUD: readonly TypeRecipeId[] = ["giant-word", "poster", "bleed", "window", "echo", "split"];
const CALM: readonly TypeRecipeId[] = ["vertical-column", "title-card", "whisper", "brush-write", "cross", "grid-poem", "scatter"];

function kindEnergy(kind: SectionKind | null, sectionEnergy: number, ordinal: number): number {
  const e = clamp(sectionEnergy, 0, 1);
  switch (kind) {
    case "chorus":
      return clamp(0.62 + 0.25 * e + 0.05 * ordinal, 0.55, 0.95);
    case "pre-chorus":
      return clamp(0.42 + 0.2 * e, 0.35, 0.65);
    case "verse":
      return clamp(0.28 + 0.25 * e, 0.22, 0.55);
    case "bridge":
      return clamp(0.38 + 0.25 * e, 0.3, 0.65);
    case "breakdown":
    case "intro":
    case "outro":
      return clamp(0.18 + 0.2 * e, 0.12, 0.42);
    default:
      return clamp(0.3 + 0.3 * e, 0.2, 0.6);
  }
}

function orientationFor(recipe: TypeRecipeId, cjk: boolean, params: TypeParams, pick: number, contrast: boolean): TypeOrientation {
  if (!cjk) return "h";
  const vr = clamp(params.verticalRatio, 0, 1);
  switch (recipe) {
    case "vertical-column":
    case "brush-write":
      return "v";
    case "cross":
      return "mixed";
    case "poster":
      return "h";
    case "giant-word":
      if (contrast) return vr > 0.5 ? "h" : "mixed";
      return pick < vr * 0.75 ? "mixed" : pick < vr * 0.95 ? "v" : "h";
    default: {
      const p = contrast ? 1 - vr : vr;
      return pick < p * 0.55 ? "v" : "h";
    }
  }
}

export interface AutoHintContext {
  voice: TypeVoiceId;
  params: TypeParams;
  sectionKind: SectionKind | null;
  sectionEnergy: number;
  salt: number;
}

/** A hint for a line nothing else describes (a line added after the design): deterministic from its text. */
export function autoHint(line: LyricLine, index: number, c: AutoHintContext): TypeLine {
  const rng = createRng(`auto|${c.salt}|${textKey(line.text)}|${c.voice}`);
  const cjk = CJK_RE.test(line.text);
  const energy = kindEnergy(c.sectionKind, c.sectionEnergy, 0);
  const pool = Object.entries(VOICES[c.voice].recipes) as Array<[TypeRecipeId, number]>;
  const usable = pool.filter(([id]) => cjk || !RECIPES[id].cjkOnly);
  const total = usable.reduce((a, [, w]) => a + w, 0);
  let x = rng.next() * total;
  let recipe: TypeRecipeId = usable[0]?.[0] ?? "title-card";
  for (const [id, w] of usable) {
    x -= w;
    if (x <= 0) {
      recipe = id;
      break;
    }
  }
  if (energy < 0.3) recipe = "whisper";
  const motionWord = findMotionWord(line.text);
  return { lineId: line.id, recipe, emphasis: motionWord ? [motionWord] : [], orientation: orientationFor(recipe, cjk, c.params, rng.next(), false), energy: r2(energy), motionWord, seed: rng.int(1000) };
}

export interface SequenceInput {
  lines: readonly LyricLine[];
  sections: readonly SectionDesign[];
  duration: number;
  voice: TypeVoiceId;
  params: TypeParams;
  /** 「重新生成全部構圖」 bumps it: another draw of the same rules */
  salt?: number;
  /** hints to keep exactly (locked lines, or what Claude already wrote) */
  keep?: ReadonlyMap<string, TypeLine>;
  /** the designer's emphasis for a line (imagery words, the sing-along phrase); exact substrings */
  emphasisFor?: (line: LyricLine, index: number) => string[];
  /** the designer's motion word for a line */
  motionFor?: (line: LyricLine, index: number) => string;
  /**
   * The band's lyric policy, read as typographic intensity (every line still appears):
   * chorus-only = verses restrained, minimal = only the hook is big, full = every line designed.
   */
  policy?: "chorus-only" | "full" | "minimal" | null;
  /** the song's hook (most repeated line), for the minimal policy */
  hookKey?: string | null;
}

interface LineSlot {
  index: number;
  line: LyricLine;
  key: string;
  section: SectionDesign | null;
  sectionIndex: number | null;
  chorusOrdinal: number;
  lastChorus: boolean;
  cjk: boolean;
  count: number;
}

function slotsOf(input: SequenceInput): LineSlot[] {
  const chorusIdx = input.sections.map((s, i) => (s.kind === "chorus" ? i : -1)).filter((i) => i >= 0);
  const last = chorusIdx.length > 1 ? chorusIdx[chorusIdx.length - 1] : -1;
  const plan = { sections: input.sections } as unknown as Parameters<typeof sectionIndexAt>[0];
  const out: LineSlot[] = [];
  input.lines.forEach((line, index) => {
    if (!line || typeof line.text !== "string" || !line.text.trim()) return;
    const anchor = lineAnchor(input.lines as LyricLine[], index, input.duration);
    const si = anchor != null ? sectionIndexAt(plan, anchor) : null;
    const section = si != null ? (input.sections[si] ?? null) : null;
    out.push({
      index,
      line,
      key: textKey(line.text),
      section,
      sectionIndex: si,
      chorusOrdinal: si != null ? chorusIdx.indexOf(si) : -1,
      lastChorus: si != null && si === last,
      cjk: CJK_RE.test(line.text),
      count: units(line.text),
    });
  });
  return out;
}

function exactSubstrings(list: readonly string[], text: string): string[] {
  return list.filter((w, i) => typeof w === "string" && w.trim() && text.includes(w.trim()) && list.indexOf(w) === i).map((w) => w.trim()).slice(0, 2);
}

/** A hint for every non-empty line, in lyric order. */
export function sequenceTypeLines(input: SequenceInput): TypeLine[] {
  const salt = input.salt ?? 0;
  const voice = VOICES[input.voice];
  const slots = slotsOf(input);
  const firstOf = new Map<string, TypeLine>();
  const recipeUse = new Map<TypeRecipeId, number>();
  const out: TypeLine[] = [];
  let prevRecipe: TypeRecipeId | null = null;
  let prev2Recipe: TypeRecipeId | null = null;
  let prevSide: string | null = null;
  const verseRecipes = new Set<TypeRecipeId>();
  const chorusRecipes = new Set<TypeRecipeId>();
  let prevSection: number | null = null;
  let posInSection = 0;

  for (const s of slots) {
    const kept = input.keep?.get(s.line.id);
    if (s.sectionIndex !== prevSection) {
      posInSection = 0;
      prevSection = s.sectionIndex;
    } else posInSection++;
    if (kept) {
      out.push(kept);
      if (!firstOf.has(s.key)) firstOf.set(s.key, kept);
      prev2Recipe = prevRecipe;
      prevRecipe = kept.recipe;
      prevSide = zoneFor(kept.seed).side;
      continue;
    }
    const first = firstOf.get(s.key);
    if (first) {
      // a repeat: the same composition, the last chorus a little bigger (within the band's policy)
      let energy = s.lastChorus ? clamp(first.energy + 0.1, 0, 1) : first.energy;
      if (input.policy === "chorus-only" && s.section?.kind !== "chorus") energy = Math.min(energy, 0.34);
      if (input.policy === "minimal" && s.key !== input.hookKey) energy = Math.min(energy, 0.26);
      const hint: TypeLine = { lineId: s.line.id, recipe: first.recipe, emphasis: exactSubstrings(first.emphasis, s.line.text), orientation: first.orientation, energy: r2(energy), motionWord: s.line.text.includes(first.motionWord) ? first.motionWord : "", seed: first.seed };
      out.push(hint);
      prev2Recipe = prevRecipe;
      prevRecipe = hint.recipe;
      prevSide = zoneFor(hint.seed).side;
      continue;
    }
    const rng = createRng(`seq|${salt}|${input.voice}|${s.index}|${s.key}`);
    const kind = s.section?.kind ?? null;
    let energy = kindEnergy(kind, s.section?.energy ?? 0.5, Math.max(0, s.chorusOrdinal));
    if (s.lastChorus) energy = clamp(energy + 0.08, 0, 1);
    // the band's lyric policy as typographic intensity
    if (input.policy === "chorus-only" && kind !== "chorus") energy = Math.min(energy, 0.34);
    if (input.policy === "minimal" && s.key !== input.hookKey) energy = Math.min(energy, 0.26);
    const quiet = energy < 0.28 || (kind === "outro" && posInSection > 0) || kind === "breakdown";
    const bridge = kind === "bridge";

    // recipe: the voice's palette, weighted by the section's role and the line, never the previous one
    const weights = new Map<TypeRecipeId, number>();
    for (const [id, w] of Object.entries(voice.recipes) as Array<[TypeRecipeId, number]>) {
      const info = RECIPES[id];
      if (info.cjkOnly && !s.cjk) continue;
      let k = w;
      const [lo, hi] = info.energy;
      if (energy < lo - 0.08 || energy > hi + 0.1) k *= 0.2;
      if (kind === "chorus" && LOUD.includes(id)) k *= 1.8;
      if (kind === "chorus" && id === "whisper") k *= 0.05;
      if ((kind === "verse" || kind === "pre-chorus") && CALM.includes(id)) k *= 1.5;
      if ((kind === "verse" || kind === "pre-chorus") && (id === "bleed" || id === "window")) k *= 0.35;
      if (bridge && !verseRecipes.has(id) && !chorusRecipes.has(id)) k *= 2.4;
      if (quiet && id === "whisper") k *= 6;
      if (s.count > 14 && (id === "scatter" || id === "grid-poem" || id === "bleed" || id === "window")) k *= 0.3;
      if (s.count <= 4 && (id === "giant-word" || id === "window" || id === "bleed")) k *= 1.8;
      if (id === prevRecipe) k *= 0.02;
      if (id === prev2Recipe) k *= 0.5;
      // spread the palette across the song
      k /= 1 + 0.25 * (recipeUse.get(id) ?? 0);
      if (k > 0) weights.set(id, k);
    }
    const entries = [...weights.entries()];
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let pick = rng.next() * total;
    let recipe: TypeRecipeId = entries[0]?.[0] ?? "title-card";
    for (const [id, w] of entries) {
      pick -= w;
      if (pick <= 0) {
        recipe = id;
        break;
      }
    }
    if (quiet && voice.recipes.whisper == null && recipe !== "whisper" && rng.chance(0.5)) recipe = "whisper";
    recipeUse.set(recipe, (recipeUse.get(recipe) ?? 0) + 1);
    if (kind === "verse" || kind === "pre-chorus") verseRecipes.add(recipe);
    if (kind === "chorus") chorusRecipes.add(recipe);

    const orientation = orientationFor(recipe, s.cjk, input.params, rng.next(), bridge);
    // the seed: another side of the frame than the previous line
    let seed = rng.int(1000);
    for (let tries = 0; tries < 16 && prevSide != null && zoneFor(seed).side === prevSide; tries++) seed = rng.int(1000);
    const motionWord = (input.motionFor?.(s.line, s.index) ?? findMotionWord(s.line.text)).trim();
    const mw = motionWord && s.line.text.includes(motionWord) ? motionWord : "";
    let emphasis = exactSubstrings(input.emphasisFor?.(s.line, s.index) ?? [], s.line.text);
    if (!emphasis.length && mw && (kind === "chorus" || LOUD.includes(recipe))) emphasis = [mw];
    const hint: TypeLine = { lineId: s.line.id, recipe, emphasis, orientation, energy: r2(energy), motionWord: mw, seed };
    out.push(hint);
    firstOf.set(s.key, hint);
    prev2Recipe = prevRecipe;
    prevRecipe = recipe;
    prevSide = zoneFor(seed).side;
  }
  return out;
}

/** 「重新生成全部構圖」: every unlocked line drawn again (its edit dropped), locked lines kept as they are. */
export function regenerateLines(input: Omit<SequenceInput, "keep" | "salt">, current: readonly TypeLine[], generation: number): TypeLine[] {
  const keep = new Map<string, TypeLine>();
  for (const l of current) if (l.locked) keep.set(l.lineId, l);
  return sequenceTypeLines({ ...input, keep, salt: generation });
}

/** A stable seed from text (for callers that need one without a generator). */
export function seedOf(text: string): number {
  return hash32(text) % 1000;
}
