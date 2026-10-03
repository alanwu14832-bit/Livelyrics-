// normalizePlan: turn any (possibly partial or slightly wrong) plan into a valid,
// renderer-safe DesignPlan for this song. Every Claude and offline plan passes through
// here. It never throws; unusable parts are replaced with deterministic defaults.
//
// 字體藝術 (phase 6): a design output always leaves with a type system — the engine's own,
// repaired (numbers clamped, fonts in the right script, unknown recipes and emphasis dropped), with
// the per-line hints it left out filled by the sequencer — and without the karaoke / subtitle
// styles no automatic designer picks any more. A stored plan that is only shifted or kept (the show
// arc, an offline instruction, the previous plan) keeps its type system, or its absence.

import { normalizeSceneProgram } from "@/lib/stage/program/model";
import {
  FONT_IDS,
  LYRIC_PLACEMENTS,
  LYRIC_STYLE_IDS,
  MEDIA_BLENDS,
  MEDIA_FITS,
  MEDIA_TREATMENTS,
  SCENE_IDS,
  SECTION_KINDS,
  TYPE_VOICE_IDS,
  type CueNote,
  type DesignPlan,
  type FontId,
  type KeyVisual,
  type LineDesign,
  type LyricPlacement,
  type LyricStyleId,
  type SceneId,
  type SectionDesign,
  type SectionKind,
  type SectionMedia,
  type TypeSystem,
} from "@/lib/schema";
import type { Asset, LyricLine } from "@/lib/types";
import { normalizeTypeSystem } from "@/lib/type/normalize";
import { voiceFonts } from "@/lib/type/vocab";
import { activeBible } from "./bible-style";
import { FONT_CATALOG, SECTION_KIND_LABELS } from "./catalog";
import { colorName, contrastRatio, ensureContrast, hexToHsl, hsl, luminance, MIN_LYRIC_CONTRAST, normalizeHex } from "./color";
import { capCues, CHECK_MIN_DURATION, genericCues, MAX_CUES, MIN_CUES, suggestCues } from "./cues";
import { buildPalette, darkestIndex, SCHEMES, type PaletteEntry } from "./palette";
import { analyzeFindings, type Findings } from "./findings";
import { analyzeStructure, cjkShare, clamp, defaultKindEnergy, isFiniteNumber, meanEnvelope, resolveDuration, round3 } from "./structure";
import { generateMotifSvg, hashString, sanitizeSvg } from "./svg";
import { chooseVoice, designTypeSystem, hookKeyOf, lineEmphasis, lineMotion, typePolicy } from "./type-design";
import type { DesignerInput } from "./types";

type Obj = Record<string, unknown>;

/** Sections shorter than this are merged into a neighbour. */
export const MIN_SECTION_SECONDS = 2;
export const MAX_SECTIONS = 48;
const TRANSITIONS = ["cut", "fade", "flash", "wipe", "bloom"] as const;
const CUE_KINDS = ["drop", "singalong", "quiet", "transition", "highlight", "warning"] as const;
const PALETTE_ROLES = ["背景", "主色", "點綴", "歌詞", "高光", "輔色"];

export interface NormalizeReport {
  plan: DesignPlan;
  /** human-readable (繁中) notes about what had to be repaired */
  repairs: string[];
}

export interface NormalizeOptions {
  /**
   * "fill" (a design output, the default): the plan leaves with a type system — the engine's,
   * repaired and completed, or the rule-based one when it wrote none — and karaoke / subtitle are
   * replaced (no automatic designer chooses them). "keep" (a stored plan shifted or kept): its type
   * system is repaired when it has one; an old plan without one keeps its legacy lyric styles.
   */
  typeSystem?: "fill" | "keep";
}

/** What a design output uses instead of the legacy karaoke / subtitle styles. */
const LEGACY_REPLACEMENT: Partial<Record<LyricStyleId, LyricStyleId>> = { karaoke: "word-pop", subtitle: "line-fade" };

// ---------------------------------------------------------------------------
// primitive coercion
// ---------------------------------------------------------------------------

function asObj(x: unknown): Obj | null {
  return x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null;
}

function asArray(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

function num(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function text(x: unknown, fallback: string, max: number): string {
  if (typeof x !== "string") return fallback;
  // strip control characters, keep newlines for Markdown fields
  const s = x.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!s) return fallback;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function oneLine(x: unknown, fallback: string, max: number): string {
  return text(typeof x === "string" ? x.replace(/\s+/g, " ") : x, fallback, max);
}

function oneOf<T extends string>(x: unknown, values: readonly T[]): T | null {
  if (typeof x !== "string") return null;
  const v = x.trim();
  if ((values as readonly string[]).includes(v)) return v as T;
  const lower = v.toLowerCase().replace(/[\s_]+/g, "-");
  return (values as readonly string[]).includes(lower) ? (lower as T) : null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function unit(x: unknown, fallback: number): number {
  const n = num(x);
  return r2(clamp(n ?? fallback, 0, 1));
}

function stringList(x: unknown, maxItems: number, maxLen: number): string[] {
  const out: string[] = [];
  for (const v of asArray(x)) {
    const s = oneLine(v, "", maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

const KIND_HINTS: Array<[RegExp, SectionKind]> = [
  [/pre-?chorus|導歌|预副歌|預副歌/i, "pre-chorus"],
  [/chorus|hook|refrain|副歌|合唱/i, "chorus"],
  [/verse|主歌/i, "verse"],
  [/intro|前奏|開場|序/i, "intro"],
  [/outro|ending|尾奏|結尾|收尾/i, "outro"],
  [/bridge|橋段|桥段/i, "bridge"],
  [/solo|獨奏|独奏|solo/i, "solo"],
  [/breakdown|drop/i, "breakdown"],
  [/interlude|間奏|间奏|instrumental/i, "interlude"],
];

function guessKind(label: string): SectionKind | null {
  for (const [re, kind] of KIND_HINTS) if (re.test(label)) return kind;
  return null;
}

// ---------------------------------------------------------------------------
// key visual
// ---------------------------------------------------------------------------

function normalizePalette(raw: unknown, seed: number, repairs: string[]): PaletteEntry[] {
  const seen = new Set<string>();
  const out: PaletteEntry[] = [];
  let dropped = 0;
  for (const item of asArray(raw)) {
    const o = asObj(item);
    const hex = normalizeHex(o ? o.hex : item);
    if (!hex) {
      dropped++;
      continue;
    }
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push({
      hex,
      role: oneLine(o?.role, PALETTE_ROLES[out.length] ?? "輔色", 16),
      name: oneLine(o?.name, colorName(hex), 16),
    });
  }
  if (dropped) repairs.push(`移除 ${dropped} 個無效的色碼`);

  if (out.length === 0) {
    repairs.push("主視覺沒有可用的調色盤，改用生成的配色");
    return buildPalette({ hue: seed % 360, scheme: SCHEMES[seed % SCHEMES.length], saturation: 0.8, brightness: 0.5 }).slice(0, 5);
  }

  // first = deepest background tone
  const d = darkestIndex(out.map((p) => p.hex));
  if (d !== 0 && luminance(out[0].hex) > 0.12) {
    const [dark] = out.splice(d, 1);
    out.unshift(dark);
  }
  if (luminance(out[0].hex) > 0.2) {
    const { h, s } = hexToHsl(out[0].hex);
    const bg = hsl(h, Math.min(0.5, s), 0.06);
    if (!seen.has(bg)) {
      out.unshift({ hex: bg, role: "背景", name: colorName(bg) });
      seen.add(bg);
      repairs.push("補上深色背景色");
    }
  }
  // a color that can carry lyrics
  const bg = out[0].hex;
  if (!out.slice(0, 6).some((p) => contrastRatio(p.hex, bg) >= MIN_LYRIC_CONTRAST)) {
    const { h } = hexToHsl(out[1]?.hex ?? bg);
    const lyric = ensureContrast(hsl(h, 0.35, 0.95), bg, []);
    const entry = { hex: lyric, role: "歌詞", name: colorName(lyric) };
    if (out.length >= 6) out[5] = entry;
    else out.push(entry);
    seen.add(lyric);
    repairs.push("補上高對比的歌詞色");
  }
  // at least 4 colors: derive tints of the existing ones
  let k = 1;
  while (out.length < 4 && k < 12) {
    const base = hexToHsl(out[k % out.length].hex);
    const cand = hsl(base.h + 24 * k, clamp(base.s + 0.1, 0.3, 0.95), clamp(0.55 + 0.05 * k, 0.4, 0.8));
    if (!seen.has(cand)) {
      seen.add(cand);
      out.push({ hex: cand, role: PALETTE_ROLES[out.length] ?? "輔色", name: colorName(cand) });
    }
    k++;
  }
  return out.slice(0, 6);
}

function normalizeTypography(raw: unknown, repairs: string[]): KeyVisual["typography"] {
  const o = asObj(raw) ?? {};
  const a = oneOf<FontId>(o.cjkFont, FONT_IDS);
  const b = oneOf<FontId>(o.latinFont, FONT_IDS);
  let cjkFont: FontId;
  if (a && FONT_CATALOG[a].cjk) cjkFont = a;
  else if (b && FONT_CATALOG[b].cjk) cjkFont = b;
  else cjkFont = "noto-sans-tc";
  let latinFont: FontId;
  if (b && !FONT_CATALOG[b].cjk) latinFont = b;
  else if (a && !FONT_CATALOG[a].cjk) latinFont = a;
  else latinFont = FONT_CATALOG[cjkFont].generic === "serif" ? "playfair-display" : "space-grotesk";
  if (cjkFont !== a || latinFont !== b) repairs.push("修正字體配對（中文字需用 CJK 字體）");

  const w = num(o.weight);
  // schema range 300–900; LED legibility needs 600+
  let weight = Math.round(clamp(w ?? 700, 300, 900) / 100) * 100;
  if (weight < 600) {
    weight = 600;
    repairs.push("字重提高到 600（大螢幕可讀性）");
  }
  const ls = num(o.letterSpacing);
  return {
    cjkFont,
    latinFont,
    weight,
    letterSpacing: Math.round(clamp(ls ?? 0.02, -0.02, 0.2) * 1000) / 1000,
    rationale: text(o.rationale, `${FONT_CATALOG[cjkFont].label}搭配 ${FONT_CATALOG[latinFont].label}，粗字重確保遠距離可讀。`, 400),
  };
}

function normalizeKeyVisual(raw: unknown, input: DesignerInput, seed: number, repairs: string[]): KeyVisual {
  const o = asObj(raw) ?? {};
  const title = oneLine(o.title, input.meta.title ? `${input.meta.title}的舞台` : "舞台主視覺", 24);
  const moodKeywords = stringList(o.moodKeywords, 6, 12);
  for (const fill of ["現場", "光", "脈動"]) if (moodKeywords.length < 3 && !moodKeywords.includes(fill)) moodKeywords.push(fill);
  const motifs = stringList(o.motifs, 5, 40);
  for (const fill of ["主視覺符號", "光的節奏"]) if (motifs.length < 2 && !motifs.includes(fill)) motifs.push(fill);

  let motifSvg = sanitizeSvg(o.motifSvg);
  if (!motifSvg) {
    if (typeof o.motifSvg === "string" && o.motifSvg.trim()) repairs.push("主視覺 SVG 未通過安全檢查，改用生成的符號");
    motifSvg = generateMotifSvg(`${input.meta.title}|${input.meta.artist}`);
  }
  return {
    title,
    concept: text(o.concept, `以「${title}」為主軸的舞台世界：畫面托起樂團，只在關鍵段落讓歌詞成為視覺的一部分。`, 1200),
    moodKeywords,
    palette: normalizePalette(o.palette, seed, repairs),
    motifs,
    motifSvg,
    typography: normalizeTypography(o.typography, repairs),
  };
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

interface Draft extends Omit<SectionDesign, "id"> {
  /** original order, for stable sorting */
  order: number;
}

function defaultStyle(kind: SectionKind): LyricStyleId {
  switch (kind) {
    case "chorus":
      return "word-pop";
    case "intro":
    case "outro":
    case "solo":
    case "interlude":
      return "hidden";
    case "bridge":
      return "stack";
    default:
      return "line-fade";
  }
}

function defaultScene(energy: number): SceneId {
  if (energy >= 0.75) return "particles";
  if (energy >= 0.5) return "waves";
  if (energy >= 0.3) return "nebula";
  return "gradient";
}

function defaultPlacement(style: LyricStyleId): LyricPlacement {
  if (style === "vertical") return "vertical-right";
  if (style === "subtitle") return "lower-third";
  return "center";
}

function pickColorway(raw: unknown, palette: readonly string[]): string[] {
  const given = asArray(raw)
    .map((c) => normalizeHex(c))
    .filter((c): c is string => c != null);
  const out = given.slice(0, 3);
  if (out.length === 3) return out;
  const darkest = palette[darkestIndex(palette)];
  if (out.length === 0) out.push(darkest);
  for (const c of palette) {
    if (out.length >= 3) break;
    if (!out.includes(c) && c !== darkest) out.push(c);
  }
  while (out.length < 3) out.push(out[out.length - 1]);
  return out;
}

/**
 * A section's `media`: null unless it names one of the project's assets. Missing fields get
 * defaults (logos are shown whole, video defaults to cutting on the beat).
 */
export function normalizeMedia(raw: unknown, assets: ReadonlyMap<string, Asset>): SectionMedia | null {
  const o = asObj(raw);
  if (!o || typeof o.assetId !== "string") return null;
  const asset = assets.get(o.assetId.trim());
  if (!asset) return null;
  const fallbackTreatment = asset.kind === "video" ? "beat-cut" : asset.kind === "logo" ? "full" : "duotone";
  const opacity = num(o.opacity);
  return {
    assetId: asset.id,
    treatment: oneOf(o.treatment, MEDIA_TREATMENTS) ?? fallbackTreatment,
    fit: oneOf(o.fit, MEDIA_FITS) ?? (asset.kind === "logo" ? "contain" : "cover"),
    opacity: r2(clamp(opacity ?? 0.85, 0, 1)),
    blend: oneOf(o.blend, MEDIA_BLENDS) ?? (asset.kind === "logo" ? "screen" : "normal"),
  };
}

function draftSection(raw: unknown, order: number, ctx: SectionCtx): Draft | null {
  const o = asObj(raw);
  if (!o) return null;
  const start = num(o.start);
  const end = num(o.end);
  if (start == null || end == null) return null;
  const label0 = oneLine(o.label, "", 20);
  const kind = oneOf<SectionKind>(o.kind, SECTION_KINDS) ?? guessKind(`${label0} ${typeof o.kind === "string" ? o.kind : ""}`) ?? "verse";
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const energy = num(o.energy);
  const envEnergy = meanEnvelope(ctx.input.analysis, "energy", clamp(lo, 0, ctx.duration), clamp(hi, 0, ctx.duration));
  const e = r2(clamp(energy ?? envEnergy ?? defaultKindEnergy(kind), 0, 1));
  const params = asObj(o.sceneParams) ?? {};
  let lyricStyle = oneOf<LyricStyleId>(o.lyricStyle, LYRIC_STYLE_IDS) ?? defaultStyle(kind);
  const replaced = ctx.fill ? LEGACY_REPLACEMENT[lyricStyle] : undefined;
  if (replaced) {
    lyricStyle = replaced;
    ctx.legacyStyles++;
  }
  const colorway = pickColorway(o.colorway, ctx.palette);
  const preferred = normalizeHex(o.lyricColor);
  const lyricColor = ensureContrast(preferred, colorway[0], ctx.palette);
  if (preferred && preferred !== lyricColor) ctx.contrastFixes++;
  const lyricScale = num(o.lyricScale);
  return {
    order,
    kind,
    label: label0 || SECTION_KIND_LABELS[kind],
    start: lo,
    end: hi,
    energy: e,
    scene: oneOf<SceneId>(o.scene, SCENE_IDS) ?? defaultScene(e),
    sceneParams: {
      speed: unit(params.speed, 0.25 + 0.6 * e),
      density: unit(params.density, 0.35 + 0.5 * e),
      intensity: unit(params.intensity, 0.5 + 0.4 * e),
      audioReactivity: unit(params.audioReactivity, 0.25 + 0.65 * e),
    },
    colorway,
    lyricStyle,
    lyricPlacement: oneOf<LyricPlacement>(o.lyricPlacement, LYRIC_PLACEMENTS) ?? defaultPlacement(lyricStyle),
    lyricScale: r2(clamp(lyricScale ?? 1, 0.6, 1.8)),
    lyricColor,
    transitionIn: oneOf(o.transitionIn, TRANSITIONS) ?? (e >= 0.7 ? "flash" : "fade"),
    media: mediaFor(o.media, ctx),
    rationale: text(o.rationale, "", 400),
  };
}

function mediaFor(raw: unknown, ctx: SectionCtx): SectionMedia | null {
  const media = normalizeMedia(raw, ctx.assets);
  if (!media && asObj(raw)) ctx.droppedMedia++;
  return media;
}

interface SectionCtx {
  input: DesignerInput;
  duration: number;
  palette: string[];
  contrastFixes: number;
  assets: ReadonlyMap<string, Asset>;
  droppedMedia: number;
  /** a design output: karaoke / subtitle are replaced */
  fill: boolean;
  legacyStyles: number;
}

function audioBoundaries(input: DesignerInput): number[] {
  const out: number[] = [];
  for (const s of input.analysis?.sections ?? []) {
    if (isFiniteNumber(s.start)) out.push(s.start);
    if (isFiniteNumber(s.end)) out.push(s.end);
  }
  return out;
}

/** Sort, clip to 0..duration, close gaps / resolve overlaps, merge tiny sections. */
export function repairTimeline<T extends { start: number; end: number }>(items: T[], duration: number, boundaries: readonly number[] = []): T[] {
  let secs = items
    .map((s) => ({ ...s, start: clamp(s.start, 0, duration), end: clamp(s.end, 0, duration) }))
    .filter((s) => s.start < duration - 1e-6)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  // identical starts: keep the longer one
  secs = secs.filter((s, i) => i === 0 || s.start - secs[i - 1].start > 0.05);
  if (!secs.length) return [];
  for (let i = 0; i < secs.length - 1; i++) {
    const a = secs[i];
    const b = secs[i + 1];
    let cut = b.start;
    if (a.end < b.start - 1e-6) {
      // gap: snap to an audio boundary in (or right next to) it when there is one
      const mid = (a.end + b.start) / 2;
      const near = boundaries.filter((t) => t >= a.end - 1.5 && t <= b.start + 1.5 && t > a.start && t < b.end);
      if (near.length) cut = near.reduce((best, t) => (Math.abs(t - mid) < Math.abs(best - mid) ? t : best));
    }
    a.end = cut;
    b.start = cut;
  }
  secs[0].start = 0;
  secs[secs.length - 1].end = duration;
  // merge sections that are too short into a neighbour: the one whose new boundary lands
  // closer to an audio boundary (ties: the previous section)
  const minLen = Math.min(MIN_SECTION_SECONDS, duration / 4);
  const offGrid = (t: number) => (boundaries.length ? Math.min(...boundaries.map((b) => Math.abs(b - t))) : 0);
  for (let guard = 0; guard < 1000 && secs.length > 1; guard++) {
    let idx = -1;
    let shortest = minLen;
    secs.forEach((s, i) => {
      if (s.end - s.start < shortest) {
        shortest = s.end - s.start;
        idx = i;
      }
    });
    if (idx < 0) break;
    const s = secs[idx];
    const intoNext = idx === 0 || (idx < secs.length - 1 && offGrid(s.start) < offGrid(s.end) - 1e-6);
    if (intoNext) secs[idx + 1].start = s.start;
    else secs[idx - 1].end = s.end;
    secs.splice(idx, 1);
  }
  while (secs.length > MAX_SECTIONS) {
    let idx = 1;
    for (let i = 1; i < secs.length; i++) if (secs[i].end - secs[i].start < secs[idx].end - secs[idx].start) idx = i;
    secs[idx - 1].end = secs[idx].end;
    secs.splice(idx, 1);
  }
  for (const s of secs) {
    s.start = round3(s.start);
    s.end = round3(s.end);
  }
  secs[secs.length - 1].end = round3(duration);
  return secs;
}

function linesIn(lines: readonly LyricLine[], start: number, end: number): LyricLine[] {
  return lines.filter((l) => l.start != null && l.start >= start && l.start < end);
}

function finishSection(d: Draft, lines: readonly LyricLine[]): Omit<SectionDesign, "id"> {
  let { lyricStyle, lyricPlacement } = d;
  const sung = linesIn(lines, d.start, d.end);
  const latinOnly = sung.length > 0 && cjkShare(sung.map((l) => l.text)) < 0.3;
  const verticalPlacement = lyricPlacement === "vertical-right" || lyricPlacement === "vertical-left";
  if (latinOnly && (lyricStyle === "vertical" || verticalPlacement)) {
    // Latin lyrics must not be set vertically
    if (lyricStyle === "vertical") lyricStyle = "line-fade";
    lyricPlacement = "center";
  } else if (lyricStyle === "vertical" && !verticalPlacement) {
    lyricPlacement = "vertical-right";
  }
  return {
    kind: d.kind,
    label: d.label,
    start: d.start,
    end: d.end,
    energy: d.energy,
    scene: d.scene,
    sceneParams: d.sceneParams,
    colorway: d.colorway,
    lyricStyle,
    lyricPlacement,
    lyricScale: d.lyricScale,
    lyricColor: d.lyricColor,
    transitionIn: d.transitionIn,
    media: d.media,
    rationale: d.rationale || `${d.label}：${d.scene}／${lyricStyle}。`,
  };
}

// ---------------------------------------------------------------------------
// lines & cues
// ---------------------------------------------------------------------------

function normalizeLines(raw: unknown, lyricsLines: readonly LyricLine[], repairs: string[], fill = false): LineDesign[] {
  const byId = new Map(lyricsLines.map((l, i) => [l.id, { line: l, index: i }]));
  const merged = new Map<string, LineDesign & { index: number }>();
  let unknown = 0;
  let badEmphasis = 0;
  let legacy = 0;
  for (const item of asArray(raw)) {
    const o = asObj(item);
    const id = typeof o?.lineId === "string" ? o.lineId.trim() : "";
    const hit = byId.get(id);
    if (!o || !hit) {
      unknown++;
      continue;
    }
    const lineText = hit.line.text;
    const emphasis: string[] = [];
    for (const e of asArray(o.emphasis)) {
      if (typeof e !== "string") continue;
      const w = e.trim();
      if (!w) continue;
      let found: string | null = lineText.includes(w) ? w : null;
      if (!found) {
        const at = lineText.toLowerCase().indexOf(w.toLowerCase());
        if (at >= 0) found = lineText.slice(at, at + w.length);
      }
      if (!found) badEmphasis++;
      else if (!emphasis.includes(found)) emphasis.push(found);
    }
    let styleOverride = oneOf<LyricStyleId>(o.styleOverride, LYRIC_STYLE_IDS);
    if (fill && styleOverride && LEGACY_REPLACEMENT[styleOverride]) {
      styleOverride = null;
      legacy++;
    }
    const note = oneLine(o.note, "", 200);
    const prev = merged.get(id);
    if (prev) {
      for (const e of emphasis) if (!prev.emphasis.includes(e)) prev.emphasis.push(e);
      prev.styleOverride = prev.styleOverride ?? styleOverride;
      if (note && !prev.note.includes(note)) prev.note = oneLine(prev.note ? `${prev.note}；${note}` : note, "", 200);
    } else {
      merged.set(id, { lineId: id, emphasis, styleOverride, note, index: hit.index });
    }
  }
  if (unknown) repairs.push(`略過 ${unknown} 個不存在的歌詞行設定`);
  if (badEmphasis) repairs.push(`略過 ${badEmphasis} 個不在歌詞中的強調字`);
  if (legacy) repairs.push(`移除 ${legacy} 個卡拉 OK／字幕的單行樣式（每一句都依構圖排版）`);
  return [...merged.values()]
    .filter((l) => l.emphasis.length || l.styleOverride || l.note)
    .sort((a, b) => a.index - b.index)
    .map(({ lineId, emphasis, styleOverride, note }) => ({ lineId, emphasis: emphasis.slice(0, 6), styleOverride, note }));
}

function normalizeCues(raw: unknown, duration: number): CueNote[] {
  const out: CueNote[] = [];
  for (const item of asArray(raw)) {
    const o = asObj(item);
    const t = num(o?.time);
    if (!o || t == null) continue;
    const kind = oneOf(o.kind, CUE_KINDS) ?? "highlight";
    out.push({
      time: r2(clamp(t, 0, duration)),
      title: oneLine(o.title, "操作提示", 30),
      detail: oneLine(o.detail, "", 240),
      kind,
    });
  }
  return capCues(out.sort((a, b) => a.time - b.time), MAX_CUES);
}

function summaryNotes(plan: Pick<DesignPlan, "keyVisual" | "sections">): string {
  const rows = plan.sections.map((s) => `- **${s.label}**：${s.scene}／${s.lyricStyle}${s.rationale ? ` — ${s.rationale}` : ""}`);
  return `## 設計說明\n主視覺「${plan.keyVisual.title}」。\n\n## 段落\n${rows.join("\n")}\n\n## 現場注意\n任何狀況都可以先按 **B** 全黑；樂團即興延長時改用現場模式手動 cue。`;
}

// ---------------------------------------------------------------------------
// 字體藝術: the type system
// ---------------------------------------------------------------------------

function normalizeTypeOf(root: Obj, input: DesignerInput, plan: { keyVisual: KeyVisual; sections: SectionDesign[]; lines: LineDesign[] }, duration: number, fill: boolean, repairs: string[]): TypeSystem | null {
  const raw = asObj(root.typeSystem);
  if (!raw && !fill) return null;
  const lyricsLines = Array.isArray(input.lyrics?.lines) ? input.lyrics.lines.filter((l) => l && typeof l.id === "string" && typeof l.text === "string") : [];
  const bible = activeBible(input.bible);
  // the findings are only read when something has to be chosen or filled
  let found: Findings | null = null;
  let structure: ReturnType<typeof analyzeStructure> | null = null;
  const st = () => (structure ??= analyzeStructure(input));
  const findings = () => (found ??= analyzeFindings(input, st()));
  const typo = plan.keyVisual.typography;
  if (!raw) {
    const { system } = designTypeSystem({
      lines: lyricsLines,
      sections: plan.sections,
      duration,
      findings: findings(),
      cjk: st().cjk,
      bible,
      planFonts: { cjk: typo.cjkFont, latin: typo.latinFont },
      lineDesigns: plan.lines,
      bandName: input.bandName,
      title: input.meta?.title,
    });
    if (lyricsLines.some((l) => l.text.trim())) repairs.push("補上字體語言與每一行歌詞的構圖（依曲風與歌詞自動排版，可以到「排版」頁調整）");
    return system;
  }
  const given = oneOf(raw.voice, TYPE_VOICE_IDS);
  const voice = given ?? chooseVoice(findings(), st().cjk).voice;
  const ids = new Set(asArray(raw.lines).map((l) => (asObj(l)?.lineId as string | undefined) ?? ""));
  const missing = lyricsLines.some((l) => l.text.trim() && !ids.has(l.id));
  const emphasis = new Map(plan.lines.filter((l) => l.emphasis.length).map((l) => [l.lineId, l.emphasis] as const));
  const fonts = bible ? voiceFonts(voice, { cjk: bible.fonts.cjkFont, latin: bible.fonts.latinFont }, true) : voiceFonts(voice, { cjk: typo.cjkFont, latin: typo.latinFont });
  const { system, repairs: more } = normalizeTypeSystem(raw, {
    lines: lyricsLines,
    sections: plan.sections,
    duration,
    voice,
    fonts,
    emphasisFor: (line) => emphasis.get(line.id) ?? lineEmphasis(line, findings()),
    motionFor: (line) => lineMotion(line, findings()),
    policy: missing ? typePolicy(bible, bible ? null : findings()) : null,
    hookKey: missing ? hookKeyOf(lyricsLines) : null,
    keepEdits: true,
  });
  repairs.push(...more);
  return system;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/** Normalize and report what was repaired. */
export function normalizePlanWithReport(raw: unknown, input: DesignerInput, options: NormalizeOptions = {}): NormalizeReport {
  const repairs: string[] = [];
  const fill = (options.typeSystem ?? "fill") === "fill";
  const root = asObj(raw) ?? {};
  const duration = round3(resolveDuration(input));
  const seed = hashString(`${input.meta?.title ?? ""}|${input.meta?.artist ?? ""}`);
  const keyVisual = normalizeKeyVisual(root.keyVisual, input, seed, repairs);
  const palette = keyVisual.palette.map((p) => p.hex);
  const lyricsLines = Array.isArray(input.lyrics?.lines) ? input.lyrics.lines : [];

  const assets = new Map((Array.isArray(input.assets) ? input.assets : []).filter((a) => a && typeof a.id === "string").map((a) => [a.id, a] as const));
  const ctx: SectionCtx = { input, duration, palette, contrastFixes: 0, assets, droppedMedia: 0, fill, legacyStyles: 0 };
  const rawSections = asArray(root.sections);
  let drafts = rawSections.map((s, i) => draftSection(s, i, ctx)).filter((d): d is Draft => d != null);
  if (drafts.length < rawSections.length) repairs.push(`略過 ${rawSections.length - drafts.length} 個缺少時間的段落`);
  if (ctx.droppedMedia) repairs.push(`移除 ${ctx.droppedMedia} 個指向不存在素材的段落素材`);
  if (ctx.contrastFixes) repairs.push(`調整 ${ctx.contrastFixes} 段歌詞顏色以達到 4.5:1 對比`);
  if (ctx.legacyStyles) repairs.push(`${ctx.legacyStyles} 段的卡拉 OK／字幕樣式改為其他樣式（每一句都依構圖排版）`);
  const before = drafts.map((d) => `${d.start}-${d.end}`).join(",");
  drafts = repairTimeline(drafts, duration, audioBoundaries(input));
  if (!drafts.length) {
    repairs.push("方案沒有可用的段落，改為單一段落");
    const fallback = draftSection({ kind: "verse", label: "全曲", start: 0, end: duration }, 0, ctx);
    if (fallback) drafts = [fallback];
  }
  if (drafts.map((d) => `${d.start}-${d.end}`).join(",") !== before) repairs.push("段落時間已對齊到 0 至歌曲結尾、無縫銜接");

  const sections: SectionDesign[] = drafts.map((d, i) => ({ id: `s${i}`, ...finishSection(d, lyricsLines) }));
  const lines = normalizeLines(root.lines, lyricsLines, repairs, fill);

  let cues = normalizeCues(root.cues, duration);
  // a short clip keeps the few cues it earned: 開場 / 中段檢查 only exist on a song long enough (cues.ts)
  if (cues.length < MIN_CUES && duration >= CHECK_MIN_DURATION) {
    const extra = [...suggestCues(sections, duration, lyricsLines), ...genericCues(duration)].filter((c) => !cues.some((x) => Math.abs(x.time - c.time) < 1.5));
    cues = capCues([...cues, ...extra.slice(0, Math.max(0, MIN_CUES - cues.length))]);
    if (extra.length) repairs.push("補上操作提示");
  }

  const partial = { keyVisual, sections };
  const designerNotes = text(root.designerNotes, "", 6000) || summaryNotes(partial);
  const typeSystem = normalizeTypeOf(root, input, { keyVisual, sections, lines }, duration, fill, repairs);
  const plan: DesignPlan = { version: 1, keyVisual, sections, lines, cues, designerNotes };
  if (typeSystem) plan.typeSystem = typeSystem;
  // 專屬畫面: validated again (it is code), re-pointed at these sections
  if (root.sceneProgram != null) {
    const sceneProgram = normalizeSceneProgram(root.sceneProgram, { sections, repairs });
    if (sceneProgram) plan.sceneProgram = sceneProgram;
  }
  return { plan, repairs };
}

/** Clamp, repair and complete a plan so it is valid and safe for this song. Never throws. */
export function normalizePlan(raw: unknown, input: DesignerInput, options: NormalizeOptions = {}): DesignPlan {
  return normalizePlanWithReport(raw, input, options).plan;
}
