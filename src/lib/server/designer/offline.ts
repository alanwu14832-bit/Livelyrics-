// The offline designer: a deterministic heuristic stage-visual designer used when no
// Anthropic credential is configured or Claude fails. It reads the audio analysis
// (energy, tempo, brightness), the lyric structure (repetition = chorus) and the free-research
// findings (findings.ts: the genre's visual grammar from the public facts, the lyric imagery,
// emotion, point of view and sing-along phrases, the audio mood), and produces a tasteful, valid
// DesignPlan. The band's bible, the mood board palette and normalizePlan still have the last word.
// 字體藝術: the song's typographic voice comes from the same findings (type-design.ts) and every
// sung line gets a composition hint; no section with lyrics is hidden, none gets karaoke / subtitle.

import { assignMedia } from "./media";
import { activeBible, applyLyricPolicy, applyTreatments, avoidScene, biasScenes, biblePalette } from "./bible-style";
import type {
  BandBible,
  CueNote,
  DesignPlan,
  FontId,
  LineDesign,
  LyricPlacement,
  LyricStyleId,
  Research,
  SceneId,
  SectionDesign,
  SectionKind,
} from "@/lib/types";
import { formatTimeShort } from "@/lib/timeline";
import { FONT_CATALOG, LYRIC_PLACEMENTS_INFO, LYRIC_STYLES, SCENES, SECTION_KIND_LABELS } from "./catalog";
import { ensureContrast } from "./color";
import { buildConcept, chooseSkeleton, conceptKeywords, conceptMotifs, makeTitle, SHORT_SONG_SECONDS, type ConceptContext } from "./concept";
import { capCues, suggestCues } from "./cues";
import { analyzeFindings, type DesignHints, type Findings } from "./findings";
import { findImagery, type ImageryHit } from "./imagery";
import { sensitiveWords } from "./lyric-analysis";
import { normalizePlan } from "./normalize";
import { buildPalette, SCHEMES, type PaletteEntry, type Scheme } from "./palette";
import { analyzeStructure, clamp, meanEnvelope, readingUnits, type SongStructure, type StructSection } from "./structure";
import { generateMotifSvg, hashString, type EmblemStyle } from "./svg";
import { moodPalette, moodScenes } from "./moodboard";
import { combinedMood, placeCollected } from "./collected";
import { chooseVoice, designTypeSystem, typeNotes, type VoiceChoice } from "./type-design";
import { MOOD_VOCABULARY } from "./lexicon/moods";
import { VOICES } from "@/lib/type/vocab";
import type { DesignerInput } from "./types";
import { offlineSceneProgram } from "./scene-program";

export type MoodClass = "calm" | "warm" | "driving" | "explosive";

export interface Mood {
  bpm: number;
  tempo: "slow" | "mid" | "fast" | "unknown";
  meanEnergy: number;
  peakEnergy: number;
  dynamics: number;
  brightness: number;
  mood: MoodClass;
}

const MOOD_LABEL: Record<MoodClass, string> = { calm: "沉靜抒情", warm: "溫暖中板", driving: "律動推進", explosive: "高能爆發" };

export function analyzeMood(input: DesignerInput, st: SongStructure): Mood {
  const bpm = input.analysis && Number.isFinite(input.analysis.bpm) && input.analysis.bpm > 0 ? Math.round(input.analysis.bpm) : 0;
  const tempo = bpm === 0 ? "unknown" : bpm < 90 ? "slow" : bpm < 125 ? "mid" : "fast";
  const energies = st.sections.map((s) => s.energy);
  const meanEnergy = st.meanEnergy;
  const peakEnergy = Math.max(...energies);
  const dynamics = peakEnergy - Math.min(...energies);
  const brightness = meanEnvelope(input.analysis, "brightness", 0, st.duration) ?? 0.5;
  let mood: MoodClass;
  if (peakEnergy >= 0.85 && (bpm >= 125 || meanEnergy >= 0.6)) mood = "explosive";
  else if (meanEnergy >= 0.5 || bpm >= 110) mood = "driving";
  else if (meanEnergy < 0.35 && (bpm === 0 || bpm < 95)) mood = "calm";
  else mood = "warm";
  return { bpm, tempo, meanEnergy, peakEnergy, dynamics, brightness, mood };
}

// ---------------------------------------------------------------------------
// palette / typography / key visual
// ---------------------------------------------------------------------------

interface Palette {
  entries: PaletteEntry[];
  bg: string;
  primary: string;
  accent: string;
  lyric: string;
  highlight: string;
  bg2: string;
}

const MOOD_SCHEMES: Record<MoodClass, [Scheme, Scheme]> = {
  calm: ["analogous", "split"],
  warm: ["analogous", "split"],
  driving: ["split", "complementary"],
  explosive: ["complementary", "triadic"],
};
const MOOD_SATURATION: Record<MoodClass, number> = { calm: 0.55, warm: 0.7, driving: 0.85, explosive: 0.95 };

function makePalette(seed: number, mood: Mood, imagery: ImageryHit[], hueOverride?: number, mono = false, hints?: DesignHints): Palette {
  const top = imagery[0]?.imagery;
  const jitter = ((seed >>> 8) % 21) - 10;
  // the song's strongest image (or its genre's colour tendency) leads; the seed keeps songs apart
  const base = hints?.hue ?? top?.hue ?? null;
  const hue = hueOverride ?? (base != null ? base + jitter : seed % 360);
  const scheme = hints?.scheme ?? MOOD_SCHEMES[mood.mood][(seed >>> 4) % 2] ?? SCHEMES[0];
  const saturation = mono ? 0 : Math.min(1, MOOD_SATURATION[mood.mood] * (hints ? hints.saturation : (top?.saturation ?? 1)));
  const jittered = hints?.accentHues && hueOverride == null ? ([hints.accentHues[0] + jitter / 2, hints.accentHues[1] + jitter / 2] as [number, number]) : undefined;
  const entries = buildPalette({ hue, scheme, saturation, brightness: mood.brightness, ...(jittered && !mono ? { hues: jittered } : {}) });
  const at = (i: number) => entries[Math.min(i, entries.length - 1)].hex;
  return { entries, bg: at(0), primary: at(1), accent: at(2), lyric: at(3), highlight: at(4), bg2: at(5) };
}

function makeTypography(mood: Mood, seed: number, imagery: ImageryHit[], findings?: Findings): DesignPlan["keyVisual"]["typography"] {
  const g = findings?.genre;
  if (g) {
    const t = g.typography;
    return {
      cjkFont: t.cjkFont,
      latinFont: t.latinFont,
      weight: Math.max(600, t.weight),
      letterSpacing: t.letterSpacing,
      rationale: `${FONT_CATALOG[t.cjkFont].label}＋${FONT_CATALOG[t.latinFont].label}：${t.note}（${g.label}的字體語法），字重 ${Math.max(600, t.weight)} 在 LED 上也清楚。`,
    };
  }
  const alt = (seed >>> 12) % 2 === 1;
  const nostalgic = imagery.some((h) => ["時光", "花", "筆墨"].includes(h.imagery.name));
  let cjkFont: FontId;
  let latinFont: FontId;
  let weight: number;
  let letterSpacing: number;
  switch (mood.mood) {
    case "explosive":
      [cjkFont, latinFont, weight, letterSpacing] = ["chiron-hei-hk", alt ? "bebas-neue" : "anton", 900, 0.02];
      break;
    case "driving":
      [cjkFont, latinFont, weight, letterSpacing] = [alt ? "noto-sans-tc" : "chiron-hei-hk", alt ? "space-grotesk" : "bebas-neue", 800, 0.04];
      break;
    case "warm":
      if (nostalgic) [cjkFont, latinFont, weight, letterSpacing] = ["lxgw-wenkai-tc", "playfair-display", 700, 0.06];
      else [cjkFont, latinFont, weight, letterSpacing] = [alt ? "huninn" : "noto-sans-tc", "space-grotesk", 700, 0.04];
      break;
    case "calm":
      [cjkFont, latinFont, weight, letterSpacing] = [alt || nostalgic ? "lxgw-wenkai-tc" : "noto-serif-tc", "playfair-display", 700, 0.08];
      break;
  }
  const why: Record<MoodClass, string> = {
    explosive: "高能量的歌需要最粗、最有衝擊力的字形，遠距離也能一眼讀到口號。",
    driving: "律動推進的歌用現代粗黑體，節奏感強又穩定好讀。",
    warm: nostalgic ? "楷書的手寫溫度呼應歌詞裡的回憶與柔軟。" : "中性好讀的黑體搭配幾何拉丁字，溫暖但不花俏。",
    calm: "抒情段落以宋體／楷書帶出文學感，字重維持 700 確保 LED 上不會糊掉。",
  };
  return {
    cjkFont,
    latinFont,
    weight,
    letterSpacing,
    rationale: `${FONT_CATALOG[cjkFont].label}＋${FONT_CATALOG[latinFont].label}：${why[mood.mood]}`,
  };
}

const MOOD_EMBLEM: Record<MoodClass, EmblemStyle> = { calm: "orbit", warm: "bloom", driving: "wave", explosive: "sun" };

const CALM_EMOTIONS = new Set(["平靜內斂", "憂傷低迴"]);

/**
 * A calm song never flashes: a soft genre (folk's 「不要閃爍」), a ballad's calm lyric emotion, or a
 * slow / floating audio mood. Its drops fade or bloom in, and its cues never ask for 「閃白」.
 */
export function isCalmSong(f: Findings): boolean {
  if (f.hints.motion === "soft") return true;
  if (f.genre?.live.includes("閃爍")) return true;
  if (f.audio.quadrant === "dark-slow" || f.audio.quadrant === "gentle-float") return true;
  return f.lyrics.lineCount > 0 && CALM_EMOTIONS.has(f.lyrics.emotion.label);
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

const SCENE_CANDIDATES: Record<SectionKind, SceneId[]> = {
  intro: ["motif", "bokeh", "nebula", "gradient"],
  verse: ["waves", "ink", "particles", "nebula", "bokeh"],
  "pre-chorus": ["waves", "particles", "nebula"],
  chorus: ["particles", "grid", "shards", "tunnel"],
  bridge: ["ink", "nebula", "rain", "motif"],
  solo: ["shards", "grid", "tunnel", "particles"],
  breakdown: ["rain", "gradient", "ink", "nebula"],
  interlude: ["nebula", "motif", "waves", "bokeh"],
  outro: ["motif", "gradient", "bokeh"],
};

function fits(scene: SceneId, energy: number): boolean {
  const [lo, hi] = SCENES[scene].energy;
  return energy >= lo - 0.08 && energy <= hi + 0.08;
}

interface SectionPlanCtx {
  st: SongStructure;
  mood: Mood;
  seed: number;
  palette: Palette;
  imagery: ImageryHit[];
  cjk: boolean;
  chorusCount: number;
  /** the band's visual bible, when it decides anything */
  bible: BandBible | null;
  /** index of the loudest section that has lyrics (lyric policy without a chorus) */
  loudestLyricIndex: number;
  /** scenes the mood board's tone suggests (phase 4); [] without one */
  moodScenes: SceneId[];
  /** the free-research findings (genre grammar, imagery families, sing-along phrases…) */
  findings: Findings;
  /** 字體藝術: the song's typographic voice */
  voice: VoiceChoice;
  /** a calm song (isCalmSong): no flash, no 「推到 1.2」 */
  calm: boolean;
  /** round 12: the built-in scene this song's last chorus climaxes on (drawn per song, never the band's previous) */
  climax: SceneId;
  /** the band's most recently designed other song's climax scene (never repeated in a row) */
  bandClimax: SceneId | null;
  /** whether the song's brief calls for the motif to close it (the band has a symbol, or one strong recurring image) */
  wantsMotif: boolean;
  /** the first section's scene once chosen (the outro may return to it) */
  opening: SceneId | null;
}

const CLIMAX_SALT = 0xe9b5dba5;

/** How big a chorus scene is: the ladder climbs this rank towards the song's climax. */
const CHORUS_RANK: Partial<Record<SceneId, number>> = { particles: 1, waves: 1.5, grid: 2, shards: 3, tunnel: 4 };
const rankOf = (sc: SceneId): number => CHORUS_RANK[sc] ?? 2;

/** A well-mixed 0..1 from a seed and a salt (one mulberry32 step), so neighbouring seeds spread. */
function unit(seed: number, salt: number): number {
  let t = (seed ^ salt) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The scene a song's last chorus climaxes on. Drawn per song from the chorus scenes the genre
 * allows — the genre's own family first when it names one of them, otherwise by the seed — and
 * never the band's previous song's climax, so the catalogue does not end every song in 隧道.
 */
export function chooseClimax(ladder: readonly SceneId[], findings: Findings, seed: number, bandClimax: SceneId | null, calm = false, chorusCount = 2, salt = CLIMAX_SALT): SceneId {
  // a calm song never climaxes on a tunnel or on shards: its biggest chorus is still a quiet
  // picture (particles, the grid's horizon, the waves' bands)
  const base = calm ? [...ladder.filter((sc) => sc !== "tunnel" && sc !== "shards"), "waves" as SceneId] : [...ladder];
  // three or more choruses need room to climb: the climax is then one of the bigger scenes
  const roomy = chorusCount >= 3 ? base.filter((sc) => rankOf(sc) >= 2) : base;
  const pool = (roomy.length ? roomy : base).filter((sc) => sc !== bandClimax);
  const list = pool.length ? pool : roomy.length ? roomy : base;
  if (!list.length) return "particles";
  // a weighted draw: the genre's own scenes count three times, the rest once (so a genre leans
  // but does not lock, and the seed spreads a catalogue of one genre over the ladder)
  const preferred = new Set(findings.genre ? findings.hints.scenes.slice(0, 3) : []);
  const weights = list.map((sc) => (preferred.has(sc) ? 3 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let u = unit(seed, salt) * total;
  for (let k = 0; k < list.length; k++) {
    u -= weights[k];
    if (u < 0) return list[k];
  }
  return list[list.length - 1];
}

function chooseScene(s: StructSection, i: number, prev: SceneId | null, ordinal: number, ctx: SectionPlanCtx): SceneId {
  return avoidScene(chooseSceneRaw(s, i, prev, ordinal, ctx), ctx.bible, prev, biasScenes(SCENE_CANDIDATES[s.kind], ctx.bible));
}

/** A kind's candidates: the bible's order first, then this song's scene family (genre + imagery), without what the genre avoids. */
function songCandidates(kind: SectionKind, ctx: SectionPlanCtx): SceneId[] {
  const hints = ctx.findings.hints;
  const list = biasScenes(SCENE_CANDIDATES[kind], ctx.bible).filter((sc) => !hints.avoidScenes.includes(sc));
  const base = list.length ? list : biasScenes(SCENE_CANDIDATES[kind], ctx.bible);
  if (ctx.bible?.sceneAffinity.length || !ctx.findings.genre) return base;
  const family = hints.scenes.slice(0, 4);
  return [...base.filter((sc) => family.includes(sc)).sort((a, b) => family.indexOf(a) - family.indexOf(b)), ...base.filter((sc) => !family.includes(sc))];
}

function chooseSceneRaw(s: StructSection, i: number, prev: SceneId | null, ordinal: number, ctx: SectionPlanCtx): SceneId {
  const e = s.energy;
  const cands = (k: SectionKind) => songCandidates(k, ctx);
  if (s.kind === "chorus") {
    // choruses escalate along a ladder that ends on this song's climax scene (round 12: drawn per
    // song, not always 隧道); avoided scenes are left out
    const avoided = new Set([...(ctx.bible?.sceneAvoid ?? []), ...ctx.findings.hints.avoidScenes]);
    const kept = SCENE_CANDIDATES.chorus.filter((sc) => !avoided.has(sc));
    const base0 = kept.length ? kept : cands("chorus");
    const climax = base0.includes(ctx.climax) || ctx.climax === "waves" ? ctx.climax : base0[base0.length - 1];
    // the rungs below the climax, smallest first: the choruses climb to it (a song whose climax is
    // the smallest scene keeps every chorus there — restraint, not a drop-back)
    const rest = [...base0, ...(ctx.calm ? (["waves"] as SceneId[]) : [])].filter((sc, k, a) => sc !== climax && rankOf(sc) < rankOf(climax) && a.indexOf(sc) === k).sort((a, b) => rankOf(a) - rankOf(b));
    const ladder = [...rest, climax];
    // a genre that prefers one of the lower rungs starts its first chorus there
    const genreStart = ctx.findings.genre ? ladder.findIndex((sc) => sc !== climax && ctx.findings.hints.scenes.slice(0, 3).includes(sc)) : -1;
    const base0idx = genreStart >= 0 ? Math.min(genreStart, ladder.length - 2) : ctx.mood.mood === "explosive" ? Math.min(1, ladder.length - 2) : ctx.mood.mood === "calm" ? 0 : (ctx.seed >>> 3) % Math.max(1, ladder.length - 1);
    const base = Math.max(0, Math.min(ladder.length - 1, base0idx));
    let idx = Math.min(ladder.length - 1, base + ordinal);
    if (ordinal === ctx.chorusCount - 1 && ctx.chorusCount > 1 && e >= 0.65) idx = ladder.length - 1;
    const pick = ladder[idx];
    return pick === prev ? ladder[(idx + ladder.length - 1) % ladder.length] : pick;
  }
  if (s.kind === "breakdown" && e < 0.18 && s.lineIds.length) return "blackout";
  const kindList = cands(s.kind);
  // a scene the band prefers wins over the lyric lexicon
  const preferred = ctx.bible?.sceneAffinity.length ? kindList.find((sc) => ctx.bible!.sceneAffinity.includes(sc) && fits(sc, e) && sc !== prev) : undefined;
  if (preferred && s.kind !== "intro" && s.kind !== "outro") return preferred;
  // then what the mood board's tone suggests
  const moodPick = ctx.moodScenes.length && s.kind !== "intro" && s.kind !== "outro" ? kindList.find((sc) => ctx.moodScenes.includes(sc) && fits(sc, e) && sc !== prev) : undefined;
  if (moodPick && (s.kind === "verse" || s.kind === "bridge" || s.kind === "pre-chorus" || s.kind === "interlude")) return moodPick;
  // the song's own scene family (its images, and its genre when known), most fitting first
  const lexScene = ctx.findings.hints.scenes.find((sc) => kindList.includes(sc) && fits(sc, e) && sc !== prev);
  if (lexScene && (s.kind === "verse" || s.kind === "bridge" || s.kind === "breakdown")) return lexScene;
  const pool = kindList.filter((sc) => fits(sc, e) && sc !== prev);
  const list = pool.length ? pool : kindList.filter((sc) => sc !== prev);
  if (s.kind === "intro") {
    // the motif opens the song when the brief calls for it; otherwise the song's own quiet scene
    if (ctx.wantsMotif && list.includes("motif")) return "motif";
    const quiet = list.filter((sc) => sc !== "motif");
    return quiet[(ctx.seed >>> 11) % quiet.length] ?? list[0] ?? "motif";
  }
  if (s.kind === "outro") {
    // round 12: three ways to close — the motif only for songs whose brief calls for it, a return
    // to the opening scene, or the climax scene dying down (its energy is already low here)
    const variants: SceneId[] = [];
    if (ctx.wantsMotif && list.includes("motif")) variants.push("motif");
    if (ctx.opening && ctx.opening !== prev && ctx.opening !== "blackout") variants.push(ctx.opening);
    if (ctx.climax !== prev) variants.push(ctx.climax);
    for (const sc of list) if (sc !== prev && !variants.includes(sc)) variants.push(sc);
    const uniq = variants.filter((sc, k) => variants.indexOf(sc) === k);
    return uniq[(ctx.seed >>> 7) % Math.min(3, uniq.length)] ?? list[0] ?? "motif";
  }
  return list[(ctx.seed + i * 7 + ordinal) % list.length] ?? "nebula";
}

function sectionLines(st: SongStructure, s: StructSection) {
  const ids = new Set(s.lineIds);
  return st.lines.filter((l) => ids.has(l.id));
}

type LyricPick = { style: LyricStyleId; placement: LyricPlacement; scale: number };

const PLACEMENT_FOR: Partial<Record<LyricStyleId, LyricPlacement>> = { subtitle: "lower-third", vertical: "vertical-right", stack: "left", typewriter: "center", impact: "center", karaoke: "center", "word-pop": "center" };

/**
 * The genre's lyric grammar (free research), when a source named the genre: sparse genres
 * (post-rock, ambient, electronic…) keep verses quiet, dense ones (hip hop, metal) give verses a
 * subtitle and the hook the big letters; others follow the genre's verse / chorus styles.
 */
function genreLyrics(s: StructSection, ordinal: number, ctx: SectionPlanCtx, pick: LyricPick, avgUnits: number, poetic: boolean): LyricPick {
  const g = ctx.findings.genre;
  if (!g || pick.style === "hidden") return pick;
  const last = s.kind === "chorus" && ordinal === ctx.chorusCount - 1 && ctx.chorusCount > 1;
  const style = (id: LyricStyleId, scale = pick.scale): LyricPick => {
    const st: LyricStyleId = id === "vertical" && !(ctx.cjk && poetic) ? "stack" : id;
    return { style: st, placement: st === "line-fade" ? (s.kind === "verse" ? "upper-third" : "center") : (PLACEMENT_FOR[st] ?? pick.placement), scale };
  };
  if (s.kind === "verse" || s.kind === "pre-chorus") {
    // sparse genres keep the verse small and quiet (every line still appears), dense ones calm
    if (g.lyrics.density === "sparse") return s.kind === "verse" ? style(g.lyrics.verse, 0.85) : pick;
    if (g.lyrics.density === "dense") return style("line-fade", 0.9);
    if (s.kind === "verse" && ordinal === 0) return style(g.lyrics.verse, pick.scale);
    return pick;
  }
  if (s.kind === "chorus") {
    // the last chorus keeps the biggest treatment; the first follows the genre's chorus style
    if (last) return g.lyrics.chorus === "impact" && avgUnits <= 9 ? style("impact", 1.25) : pick;
    const target = g.lyrics.chorus === "impact" && avgUnits > 9 ? "word-pop" : g.lyrics.chorus;
    return style(target, Math.max(pick.scale, target === "impact" ? 1.15 : 1.05));
  }
  return pick;
}

function chooseLyrics(s: StructSection, ordinal: number, ctx: SectionPlanCtx): LyricPick {
  const lines = sectionLines(ctx.st, s);
  if (!lines.length) return { style: "hidden", placement: "center", scale: 1 };
  const avgUnits = lines.reduce((a, l) => a + readingUnits(l.text), 0) / lines.length;
  const poetic = ctx.cjk && avgUnits <= 10 && s.density < 3;
  return genreLyrics(s, ordinal, ctx, baseLyrics(s, ordinal, ctx, avgUnits, poetic), avgUnits, poetic);
}

function baseLyrics(s: StructSection, ordinal: number, ctx: SectionPlanCtx, avgUnits: number, poetic: boolean): LyricPick {
  const dense = s.density > 5;
  switch (s.kind) {
    case "chorus": {
      // never karaoke: the chorus is big type (字體藝術 composes every line; these are the legacy fallback)
      if (dense) return { style: "line-fade", placement: "center", scale: 1.05 };
      const last = ordinal === ctx.chorusCount - 1 && ctx.chorusCount > 1;
      if (last) return avgUnits <= 9 ? { style: "impact", placement: "center", scale: 1.2 } : { style: "word-pop", placement: "center", scale: 1.2 };
      if (ordinal === 0) return { style: "word-pop", placement: "center", scale: 1.1 };
      return avgUnits <= 9 ? { style: "impact", placement: "center", scale: 1.15 } : { style: "word-pop", placement: "center", scale: 1.15 };
    }
    case "verse":
      if (dense) return { style: "line-fade", placement: "upper-third", scale: 0.9 };
      if (ordinal % 2 === 1) return poetic ? { style: "vertical", placement: "vertical-right", scale: 1 } : { style: "stack", placement: "left", scale: 0.95 };
      return { style: "line-fade", placement: "upper-third", scale: 0.95 };
    case "pre-chorus":
      return s.density < 3 ? { style: "typewriter", placement: "center", scale: 1 } : { style: "line-fade", placement: "center", scale: 1 };
    case "bridge":
      return poetic ? { style: "vertical", placement: "vertical-right", scale: 1.05 } : { style: "stack", placement: "left", scale: 1 };
    case "breakdown":
      return poetic ? { style: "vertical", placement: "vertical-left", scale: 1.1 } : { style: "line-fade", placement: "center", scale: 1.2 };
    case "outro":
      return { style: "line-fade", placement: "center", scale: 1.25 };
    default:
      return { style: "line-fade", placement: "upper-third", scale: 1 };
  }
}

function colorwayFor(kind: SectionKind, last: boolean, p: Palette): [string, string, string] {
  switch (kind) {
    case "chorus":
      return [last ? p.bg2 : p.bg, p.accent, p.highlight];
    case "bridge":
    case "breakdown":
      return [p.bg2, p.highlight, p.primary];
    case "solo":
      return [p.bg2, p.accent, p.primary];
    case "intro":
    case "outro":
    case "interlude":
      return [p.bg, p.primary, p.highlight];
    default:
      return [p.bg, p.primary, p.accent];
  }
}

/** The genre's transition energy on top of the energy rules: soft genres never flash or cut, punchy ones cut into choruses. */
function transitionFor(s: StructSection, prev: StructSection | undefined, motion: DesignHints["motion"] = "medium", calm = false): SectionDesign["transitionIn"] {
  const t = transitionBase(s, prev);
  if (motion === "soft" || calm) return t === "flash" ? "bloom" : t === "cut" ? "fade" : t;
  if (motion === "punchy" && s.kind === "chorus" && t === "wipe") return "cut";
  return t;
}

function transitionBase(s: StructSection, prev: StructSection | undefined): SectionDesign["transitionIn"] {
  if (!prev) return "fade";
  const rise = s.energy - prev.energy;
  if (s.kind === "chorus") return rise >= 0.25 ? "flash" : "wipe";
  if (s.kind === "solo") return rise >= 0.2 ? "cut" : "wipe";
  if (rise <= -0.2 || s.kind === "outro" || s.kind === "breakdown") return "fade";
  if (prev.kind === "intro" || s.kind === "bridge") return "bloom";
  return rise >= 0.15 ? "wipe" : "fade";
}

function rationaleFor(kind: SectionKind, scene: SceneId, style: LyricStyleId, placement: LyricPlacement, energy: number, songHasLyrics: boolean, voice?: VoiceChoice): string {
  const sc = SCENES[scene].label;
  // 字體藝術: the lyrics are compositions in the song's voice (the legacy style is only a fallback)
  const ly = voice ? `${VOICES[voice.voice].short}構圖` : LYRIC_STYLES[style].label;
  const where = LYRIC_PLACEMENTS_INFO[placement].split("：")[0];
  const hidden = style === "hidden";
  // how this section treats lyrics, for sections whose sentence depends on it
  const lyricClause = !songHasLyrics ? "這首歌沒有歌詞，畫面本身就是主角" : hidden ? "這段不放歌詞" : voice ? `每一句歌詞都是「${ly}」` : `歌詞以「${ly}」放在${where}`;
  switch (kind) {
    case "intro":
      return `以「${sc}」開場，先讓觀眾認得這首歌的世界；歌詞留白。`;
    case "chorus":
      return hidden
        ? `副歌能量 ${energy.toFixed(2)}，「${sc}」隨大鼓脈動；${lyricClause}，讓光與節拍帶動全場。`
        : `副歌能量 ${energy.toFixed(2)}，「${sc}」隨大鼓脈動；${lyricClause}，邀請全場合唱。`;
    case "verse":
      if (hidden) return songHasLyrics ? `主歌以「${sc}」維持中低亮度；${lyricClause}，把焦點留給主唱。` : `主歌以「${sc}」維持中低亮度；${lyricClause}，跟著樂手的動態慢慢呼吸。`;
      return style === "subtitle"
        ? `主歌字很密，畫面「${sc}」為主、歌詞退到小字幕，不和主唱搶戲。`
        : voice
          ? `主歌以「${sc}」維持中低亮度，${lyricClause}，小而安靜、避開主唱 IMAG。`
          : `主歌以「${sc}」維持中低亮度，${lyricClause}，避開主唱 IMAG。`;
    case "pre-chorus":
      return hidden ? `導歌用「${sc}」慢慢堆疊張力；${lyricClause}，為副歌蓄勢。` : `導歌用「${sc}」慢慢堆疊張力，歌詞「${ly}」為副歌蓄勢。`;
    case "bridge":
      return hidden ? `橋段換一個畫面語彙：「${sc}」；${lyricClause}，製造轉折。` : `橋段換一個畫面語彙：「${sc}」配「${ly}」，製造文學感的轉折。`;
    case "breakdown":
      return `能量收掉，「${sc}」留白；${hidden ? "不放歌詞" : `歌詞「${ly}」`}，讓舞台燈光說話。`;
    case "solo":
    case "interlude":
      return `器樂段落交給「${sc}」與燈光，歌詞隱藏，畫面隨節拍反應。`;
    case "outro":
      return scene === "motif"
        ? `回到主視覺「${sc}」收尾，與開場呼應；${hidden ? "歌詞留白" : "最後一句放大淡出"}。`
        : `「${sc}」慢慢暗下去收尾，畫面退回安靜；${hidden ? "歌詞留白" : "最後一句放大淡出"}。`;
  }
}

function sectionLabel(kind: SectionKind, n: number, total: number): string {
  const base = SECTION_KIND_LABELS[kind];
  if (total <= 1) return base;
  const nums = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return `${base}${nums[n] ?? String(n + 1)}`;
}

function buildSections(ctx: SectionPlanCtx): SectionDesign[] {
  const { st, palette } = ctx;
  const counts = new Map<SectionKind, number>();
  for (const s of st.sections) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const seen = new Map<SectionKind, number>();
  let prevScene: SceneId | null = null;
  const tempo = ctx.mood.bpm ? clamp(ctx.mood.bpm / 120, 0.7, 1.3) : 1;
  return st.sections.map((s, i) => {
    const ordinal = seen.get(s.kind) ?? 0;
    seen.set(s.kind, ordinal + 1);
    const total = counts.get(s.kind) ?? 1;
    const scene = chooseScene(s, i, prevScene, ordinal, ctx);
    prevScene = scene;
    if (i === 0) ctx.opening = scene;
    const last = s.kind === "chorus" && ordinal === total - 1 && total > 1;
    const { style, placement, scale } = applyLyricPolicy(
      chooseLyrics(s, ordinal, ctx),
      { kind: s.kind, energy: s.energy, hasLines: s.lineIds.length > 0 },
      { bible: ctx.bible, isLastChorus: s.kind === "chorus" && ordinal === total - 1, isLoudest: i === ctx.loudestLyricIndex, hasChorus: ctx.chorusCount > 0 },
    );
    const colorway = colorwayFor(s.kind, last, palette);
    const e = s.energy;
    const chorusBoost = s.kind === "chorus" ? 0.08 + 0.04 * ordinal : 0;
    const r2 = (x: number) => Math.round(clamp(x, 0, 1) * 100) / 100;
    return {
      id: `s${i}`,
      kind: s.kind,
      label: sectionLabel(s.kind, ordinal, total),
      start: s.start,
      end: s.end,
      energy: e,
      scene,
      sceneParams: {
        speed: r2((0.18 + 0.62 * e) * tempo),
        density: r2(0.3 + 0.55 * e + chorusBoost / 2),
        intensity: r2(scene === "blackout" ? 0.2 : 0.45 + 0.45 * e + chorusBoost),
        audioReactivity: r2(0.2 + 0.7 * e + chorusBoost),
      },
      colorway,
      lyricStyle: style,
      lyricPlacement: placement,
      lyricScale: scale,
      lyricColor: ensureContrast(palette.lyric, colorway[0], palette.entries.map((p) => p.hex)),
      transitionIn: transitionFor(s, st.sections[i - 1], ctx.findings.hints.motion, ctx.calm),
      media: null,
      rationale: rationaleFor(s.kind, scene, style, placement, e, ctx.st.lines.length > 0, ctx.voice),
    };
  });
}

// ---------------------------------------------------------------------------
// lines, notes
// ---------------------------------------------------------------------------

const CHANT = /\b(hey|oh+|yeah|woah|whoa|la+|na+|go)\b|嘿|喔|哦|啦啦/i;

function buildLines(ctx: SectionPlanCtx, sections: SectionDesign[]): LineDesign[] {
  const out: LineDesign[] = [];
  const words = ctx.imagery.flatMap((h) => h.words).sort((a, b) => b.length - a.length);
  const singalong = ctx.findings.hints.singalong;
  const sectionOf = (id: string) => {
    const idx = ctx.st.sections.findIndex((s) => s.lineIds.includes(id));
    return idx >= 0 ? sections[idx] : null;
  };
  const timed = ctx.st.lines.filter((l) => l.start != null);
  const lastLine = timed[timed.length - 1];
  for (const l of ctx.st.lines) {
    const sec = sectionOf(l.id);
    if (!sec || sec.lyricStyle === "hidden") continue;
    const emphasis: string[] = [];
    // round 14: a dark word (blood, a weapon, death…) is never blown up, nor a phrase carrying one
    const dark = sensitiveWords(l.text);
    const safe = (w: string) => !dark.some((d) => w.includes(d) || d.includes(w));
    const chant = CHANT.exec(l.text)?.[0];
    if (chant) emphasis.push(chant);
    // the phrase the crowd sings back (free research), when it is only part of the line
    const phrase = !chant ? singalong.find((p) => !p.chant && p.lineIds.includes(l.id) && Array.from(p.text).length <= Array.from(l.text).length * 0.6) : undefined;
    if (phrase && l.text.includes(phrase.text) && safe(phrase.text)) emphasis.push(phrase.text);
    for (const w of words) {
      if (emphasis.length >= 2) break;
      if (l.text.includes(w) && safe(w) && !emphasis.some((e) => e.includes(w) || w.includes(e))) emphasis.push(w);
    }
    const hook = sec.kind === "chorus" && l.repeats >= 2;
    const short = readingUnits(l.text) <= 6;
    let styleOverride: LyricStyleId | null = null;
    let note = "";
    if (hook && short && (chant || l.cluster === ctx.st.hookCluster) && sec.lyricStyle !== "impact") {
      styleOverride = "impact";
      note = "口號句：巨字帶動全場";
    } else if (l === lastLine && sec.kind !== "chorus") {
      note = "最後一句，放慢淡出";
    }
    if (emphasis.length || styleOverride || note) out.push({ lineId: l.id, emphasis, styleOverride, note });
  }
  return out;
}

function arcDescription(st: SongStructure): string {
  const parts: string[] = [];
  let peak = st.sections[0];
  for (const s of st.sections) if (s.energy > peak.energy) peak = s;
  st.sections.forEach((s, i) => {
    const prev = st.sections[i - 1];
    const t = formatTimeShort(s.start);
    if (i === 0) parts.push(`${t} ${SECTION_KIND_LABELS[s.kind]}（能量 ${s.energy.toFixed(2)}）`);
    else if (s === peak) parts.push(`${t} 最高點（${s.energy.toFixed(2)}）`);
    else if (prev && s.energy - prev.energy >= 0.25) parts.push(`${t} 衝上${SECTION_KIND_LABELS[s.kind]}（${s.energy.toFixed(2)}）`);
    else if (prev && prev.energy - s.energy >= 0.25) parts.push(`${t} 回落（${s.energy.toFixed(2)}）`);
  });
  const end = st.sections[st.sections.length - 1];
  parts.push(`${formatTimeShort(end.end)} 結束`);
  return parts.join(" → ");
}

function designerNotes(ctx: SectionPlanCtx, sections: SectionDesign[], title: string, typeSystem?: DesignPlan["typeSystem"]): string {
  const choruses = sections.filter((s) => s.kind === "chorus");
  const hidden = sections.filter((s) => s.lyricStyle === "hidden").map((s) => s.label);
  const verse = sections.find((s) => s.kind === "verse");
  const short = ctx.st.duration < SHORT_SONG_SECONDS;
  const lines = [
    ...(short ? ["## 音檔太短，分析不可靠", `這段音檔只有 ${Math.round(ctx.st.duration)} 秒：速度、段落與能量都讀不準，所以只設計一個安靜的單一畫面，不閃、不切。上傳完整的音檔後再重新設計。`, ""] : []),
    "## 敘事弧線",
    short
      ? `整段用主視覺「${title}」一個畫面撐住，沒有段落變化。`
      : `以主視覺「${title}」開場建立世界觀，${arcDescription(ctx.st)}。${choruses.length >= 2 ? "畫面隨能量起伏，副歌一次比一次更亮、更快，最後回到主視覺收尾。" : choruses.length === 1 ? "畫面隨能量起伏，副歌是全曲最亮的一段，最後回到主視覺收尾。" : "畫面跟著能量的起伏走，最後回到主視覺收尾。"}`,
    "",
    "## 歌詞與動畫",
    ...(ctx.st.lines.length === 0
      ? [
          "- 這首歌目前沒有歌詞：全程由畫面與燈光敘事，安靜段落退後、能量高的段落跟著節拍爆開。",
          "- 之後在歌詞編輯器加入歌詞，再重新設計，就會得到每一段的歌詞呈現方式。",
        ]
      : [
          verse && verse.lyricStyle !== "hidden"
            ? typeSystem
              ? `- 主歌：歌詞是小而安靜的構圖、畫面「${SCENES[verse.scene].label}」保持低調，把焦點留給主唱。`
              : `- 主歌：歌詞「${LYRIC_STYLES[verse.lyricStyle].label}」、畫面「${SCENES[verse.scene].label}」保持低調，把焦點留給主唱。`
            : "- 敘事段落：畫面保持低調，把焦點留給主唱。",
          choruses.length
            ? typeSystem
              ? `- 副歌（${choruses.length} 次）：${choruses.map((c) => `${c.label}「${SCENES[c.scene].label}」`).join("、")}，歌詞放大成畫面的主角，重複的句子沿用同一個構圖讓觀眾跟唱。`
              : `- 副歌（${choruses.length} 次）：${choruses.map((c) => `${c.label}「${LYRIC_STYLES[c.lyricStyle].label}」`).join("、")}，重複的句子讓觀眾跟唱。`
            : short
              ? "- 音檔太短，沒有段落可言：歌詞小而安靜地出現。"
              : "- 沒有偵測到重複的副歌，能量最高的段落以大字呈現。",
          hidden.length ? `- ${hidden.join("、")}不放歌詞，讓畫面與燈光當主角。` : "- 每段都有歌詞，注意畫面不要過度繁忙。",
        ]),
    "",
    ...(typeSystem ? typeNotes(typeSystem, sections) : []),
    ...findingsNotes(ctx),
    "## 現場注意",
    "- 任何狀況先按 **B** 全黑；樂團即興延長或跳段時，切到現場模式手動 cue。",
    "- 歌詞放在上方或側邊，避開主唱 IMAG 與觀眾頭部遮擋的下緣。",
    ...(ctx.findings.genre && ctx.st.lines.length > 0 ? [`- ${ctx.findings.genre.label}：${ctx.findings.genre.live}`] : []),
    "",
    ctx.findings.info?.status.musicbrainz === "ok" || ctx.findings.info?.status.wikipedia === "ok"
      ? "> 這份方案由**離線設計師**依免費研究（MusicBrainz、維基百科的公開資料＋歌詞與音訊分析）自動產生，沒有使用 Claude。想要更完整的研究，可以在設計總覽用「用 claude.ai 研究」（用你自己的 claude.ai 帳號，不需 API 費用），或在首頁的「設定」加入 Anthropic API 金鑰。"
      : "> 這份方案由**離線設計師**依音訊能量、歌詞意象與重複段落自動產生，沒有經過網路研究。想要更完整的研究，可以在設計總覽用「用 claude.ai 研究」（用你自己的 claude.ai 帳號，不需 API 費用），或在首頁的「設定」加入 Anthropic API 金鑰。",
  ];
  return lines.join("\n");
}

/** What the free research found and how the plan follows it (a notes section; none when there is nothing to say). */
function findingsNotes(ctx: SectionPlanCtx): string[] {
  const f = ctx.findings;
  const rows: string[] = [];
  const sung = ctx.st.lines.length > 0;
  // an instrumental never hears about choruses and sing-alongs
  if (f.genre) rows.push(`- 曲風「${f.genre.label}」（${f.genres[0].evidence[0] ?? "公開資料"}）：${sung ? f.genre.why : `${f.genre.palette.note}，${f.genre.motifs[0]}。`}`);
  if (f.imagery.length) rows.push(`- 歌詞意象：${f.imagery.slice(0, 3).map((h) => `「${h.family.name}」→ ${h.family.colors}`).join("；")}。`);
  if (ctx.st.lines.length && f.lyrics.emotion.hits > 0) rows.push(`- 情緒：${f.lyrics.emotion.label}；人稱 ${f.lyrics.pov.label}。`);
  const phrases = f.hints.singalong.filter((p) => !p.chant).map((p) => `「${p.text}」`);
  if (ctx.st.lines.length && phrases.length) rows.push(`- 大合唱重點：${phrases.join("、")}，這幾個字在畫面上加強。`);
  rows.push(`- 音訊情緒：${f.audio.label}（${f.audio.why.split("；")[0]}）。`);
  return rows.length ? ["## 免費研究的發現", ...rows, ""] : [];
}

/**
 * Cue notes that use the free research: the phrase the crowd will sing in each chorus cue, and the
 * genre's live habit (a long crescendo, a drop, a chant) before the peak.
 */
function findingsCues(cues: CueNote[], sections: readonly SectionDesign[], f: Findings, st: SongStructure): CueNote[] {
  const phrases = f.hints.singalong;
  const out = cues.map((c) => {
    if (c.kind !== "singalong") return c;
    const sec = sections.find((s) => Math.abs(s.start - c.time) < 0.6);
    const ids = new Set(sec ? st.lines.filter((l) => l.start != null && l.start >= sec.start - 0.5 && l.start < sec.end).map((l) => l.id) : []);
    // the words the crowd sings in this chorus (the chant and the phrase), else the song's first
    const here = phrases.filter((x) => x.lineIds.some((id) => ids.has(id))).slice(0, 2);
    const said = (here.length ? here : phrases.slice(0, 1)).map((x) => `「${x.text}」`).join("、");
    return said ? { ...c, detail: `全場會一起唱${said}：${c.detail}`.slice(0, 240) } : c;
  });
  const mentionsSinger = /主唱|口號|跟唱|合唱|歌詞|喊/.test(f.genre?.live ?? "");
  if (f.genre && f.audio.peakAt != null && st.duration >= SHORT_SONG_SECONDS && (st.lines.length > 0 || !mentionsSinger)) {
    const time = Math.max(0, Math.round((f.audio.peakAt - 2) * 100) / 100);
    out.push({ time, title: `${f.genre.label}的現場`, detail: f.genre.live.slice(0, 240), kind: "highlight" });
  }
  return capCues(out.sort((a, b) => a.time - b.time));
}

// ---------------------------------------------------------------------------
// public
// ---------------------------------------------------------------------------

export interface OfflineOptions {
  /** force a base hue (degrees), e.g. from an operator instruction */
  hue?: number;
  /** monochrome palette */
  mono?: boolean;
}

export interface OfflineContext {
  structure: SongStructure;
  mood: Mood;
  imagery: ImageryHit[];
  seed: number;
  /** the free-research findings (genre grammar, lyric analysis, audio mood) */
  findings: Findings;
}

/** A clip too short to analyse becomes one section (its lines, its mean energy): nothing to cue, nothing to escalate. */
function collapseShort(st: SongStructure): SongStructure {
  if (!(st.duration < SHORT_SONG_SECONDS) || st.sections.length <= 1) return st;
  const lineIds = st.sections.flatMap((s) => s.lineIds);
  const energy = st.sections.reduce((a, s) => a + s.energy, 0) / st.sections.length;
  const density = st.sections.reduce((a, s) => a + s.density, 0) / st.sections.length;
  return { ...st, sections: [{ start: 0, end: st.duration, energy: Math.round(energy * 100) / 100, kind: lineIds.length ? "verse" : "intro", lineIds, repeatedRatio: 0, density }] };
}

export function offlineContext(input: DesignerInput): OfflineContext {
  const structure = collapseShort(analyzeStructure(input));
  const mood = analyzeMood(input, structure);
  const imagery = findImagery(
    structure.lines.map((l) => l.text),
    input.meta?.title ?? "",
  ).slice(0, 4);
  const seed = hashString(`${input.meta?.title ?? ""}|${input.meta?.artist ?? ""}`);
  return { structure, mood, imagery, seed, findings: analyzeFindings(input, structure) };
}

/** Deterministic heuristic DesignPlan (already normalized). */
export function offlineDesign(input: DesignerInput, options: OfflineOptions = {}): DesignPlan {
  const { structure: st, mood, imagery, seed, findings } = offlineContext(input);
  const hints = findings.hints;
  const bible = activeBible(input.bible);
  // the band's palette unless the operator asked for another hue / monochrome (a stated deviation)
  const fromBible = options.hue == null && !options.mono ? biblePalette(bible) : null;
  // then the mood board's colours (phase 4), measured in the browser at upload time
  // phase 8: with the research's collected material (the cover counts most)
  const moodboard = combinedMood(input.moodboard, input.collected);
  const collectedColours = (input.collected ?? []).some((c) => c.stats?.palette.length);
  const fromMood = !fromBible && options.hue == null && !options.mono ? moodPalette(moodboard) : null;
  const palette: Palette = fromBible ?? fromMood ?? makePalette(seed, mood, imagery, options.hue, options.mono, hints);
  let loudestLyricIndex = -1;
  st.sections.forEach((s, i) => {
    if (s.lineIds.length && (loudestLyricIndex < 0 || s.energy > st.sections[loudestLyricIndex].energy)) loudestLyricIndex = i;
  });
  const ctx: SectionPlanCtx = {
    st,
    mood,
    seed,
    palette,
    imagery,
    cjk: st.cjk,
    chorusCount: st.sections.filter((s) => s.kind === "chorus").length,
    bible,
    loudestLyricIndex,
    moodScenes: moodScenes(moodboard),
    findings,
    voice: chooseVoice(findings, st.cjk),
    calm: isCalmSong(findings),
    climax: "tunnel",
    bandClimax: input.bandSongs?.[0]?.chorusScene ?? null,
    wantsMotif: !!bible?.motifs.length || (findings.imagery[0]?.weight ?? 0) >= 4,
    opening: null,
  };
  ctx.climax = chooseClimax(
    SCENE_CANDIDATES.chorus.filter((sc) => !(bible?.sceneAvoid ?? []).includes(sc) && !hints.avoidScenes.includes(sc)),
    findings,
    seed,
    ctx.bandClimax,
    ctx.calm,
    ctx.chorusCount,
  );
  // the band's uploads as before; the research's collected material with restraint (one or two sections)
  const collectedIds = new Set((input.collected ?? []).map((c) => c.id));
  const uploaded = (input.assets ?? []).filter((a) => !collectedIds.has(a.id));
  const sections = applyTreatments(placeCollected(assignMedia(buildSections(ctx), uploaded), input.collected), bible, input.assets);
  // the words: a concept skeleton chosen from the findings, a title unique in the library, the song's own motifs
  const conceptCtx: ConceptContext = {
    title: "",
    songTitle: input.meta?.title?.trim() ?? "",
    artist: input.meta?.artist?.trim() ?? "",
    findings,
    structure: st,
    imagery,
    palette: palette.entries,
    bpm: mood.bpm,
    bpmConfidence: input.analysis && Number.isFinite(input.analysis.bpmConfidence) ? input.analysis.bpmConfidence : 0,
    seed,
    hasLyrics: st.lines.length > 0,
  };
  const skeleton = chooseSkeleton(conceptCtx);
  const title = makeTitle(conceptCtx, skeleton, input.takenTitles ?? []);
  conceptCtx.title = title;
  const motifs = [...(bible?.motifs ?? []).slice(0, 3), ...conceptMotifs(findings)].filter((m, i, a) => a.indexOf(m) === i).slice(0, bible?.motifs.length ? 5 : 4);
  const moodKeywords = conceptKeywords(findings, imagery);
  const emblem = hints.emblem ?? MOOD_EMBLEM[mood.mood];
  const concept = [
    buildConcept(conceptCtx, skeleton),
    bible ? `整首歌延續${input.bandName ? `${input.bandName}的` : "樂團"}視覺聖經：同一套色盤、字體與母題，讓它和其他歌活在同一個世界。` : "",
    fromMood
      ? collectedColours
        ? `配色取自研究找到的樂團素材${(input.collected ?? []).some((c) => c.provenance.kind === "cover") ? "（專輯封面）" : ""}${input.moodboard?.length ? "與參考圖" : ""}量到的主色（${fromMood.primary}、${fromMood.accent}），場景也依它們的明暗與飽和度挑選。`
        : `配色取自參考圖量到的主色（${fromMood.primary}、${fromMood.accent}），場景也依參考圖的明暗與飽和度挑選。`
      : "",
  ].join("");
  const baseTypography = makeTypography(mood, seed, imagery, findings);
  const typography = bible
    ? {
        ...baseTypography,
        cjkFont: bible.fonts.cjkFont,
        latinFont: bible.fonts.latinFont,
        weight: bible.fonts.weight,
        rationale: `${FONT_CATALOG[bible.fonts.cjkFont].label}＋${FONT_CATALOG[bible.fonts.latinFont].label}：沿用樂團視覺聖經的字體，整場演出的歌詞是同一種聲音。`,
      }
    : baseTypography;

  const cues: CueNote[] = findingsCues(suggestCues(sections, st.duration, input.lyrics?.lines ?? [], { hasLyrics: st.lines.length > 0, motion: hints.motion, calm: ctx.calm, ledSafe: true }), sections, findings, st);
  const lines = buildLines(ctx, sections);
  // 字體藝術: the song's voice and a composition for every sung line
  const { system: typeSystem } = designTypeSystem({
    lines: (input.lyrics?.lines ?? []).filter((l) => l && typeof l.id === "string" && typeof l.text === "string"),
    sections,
    duration: st.duration,
    findings,
    cjk: st.cjk,
    bible,
    planFonts: { cjk: typography.cjkFont, latin: typography.latinFont },
    lineDesigns: lines,
    bandName: input.bandName,
    title: input.meta?.title,
  });
  const plan: DesignPlan = {
    version: 1,
    keyVisual: {
      title,
      concept,
      moodKeywords,
      palette: palette.entries,
      motifs: motifs.length >= 2 ? motifs : [...motifs, ...MOOD_VOCABULARY[findings.audio.quadrant].motifs].filter((m, i, a) => a.indexOf(m) === i).slice(0, 4),
      motifSvg: generateMotifSvg(`${input.meta?.title ?? ""}|${input.meta?.artist ?? ""}`, emblem),
      typography,
    },
    sections,
    lines,
    cues,
    designerNotes: designerNotes(ctx, sections, title, st.lines.length ? typeSystem : undefined),
    typeSystem,
  };
  // 專屬畫面: the offline composer's program (form from the findings, the rest from the seed)
  plan.sceneProgram = offlineSceneProgram(input, plan, 0, findings);
  return normalizePlan(plan, input);
}

/** Heuristic research brief with the same headings as Claude's, honest about its limits. */
export function offlineResearch(input: DesignerInput, reason?: string): Research {
  const { structure: st, mood, imagery, findings } = offlineContext(input);
  const vocab = MOOD_VOCABULARY[findings.audio.quadrant];
  const artist = input.meta?.artist?.trim() || "（未填樂團）";
  const title = input.meta?.title?.trim() || "（未填歌名）";
  const choruses = st.sections.filter((s) => s.kind === "chorus");
  const quiet = st.sections.filter((s) => s.energy <= 0.32 && s.kind !== "intro" && s.kind !== "outro");
  const hook = st.hookCluster != null ? st.lines.find((l) => l.cluster === st.hookCluster) : undefined;
  const hookRepeats = hook?.repeats ?? 0;
  const timed = st.lines.some((l) => l.start != null);
  const tempo =
    mood.bpm > 0 ? `約 **${mood.bpm} BPM**（${mood.tempo === "slow" ? "慢板" : mood.tempo === "mid" ? "中板" : "快板"}）` : "速度未知（沒有音訊分析）";

  const brief = [
    `> **離線模式**：${reason ?? "沒有 Anthropic API 金鑰"}，以下是依音訊分析與歌詞自動推論的啟發式簡報，**沒有經過網路研究**，請把它當成起點而不是結論。`,
    ...(st.duration < SHORT_SONG_SECONDS ? [`> **音檔太短，分析不可靠**：只有 ${Math.round(st.duration)} 秒，請上傳完整的音檔再重新設計。`] : []),
    "",
    "## 樂團視覺識別",
    `- 無法在離線模式查證 **${artist}** 的專輯封面、MV、logo 與過往舞台設計。`,
    "- 建議操作員補上：最新專輯封面與代表色、logo 檔、近期演出照片，並在重新設計時用一句話描述樂團的視覺個性（例如「復古、霓虹、90 年代」）。",
    "",
    "## 歌曲意象與情緒",
    `- 〈${title}〉：${tempo}，整體屬於「${MOOD_LABEL[mood.mood]}」，能量動態範圍 ${mood.dynamics.toFixed(2)}。`,
    `- 能量弧線：${arcDescription(st)}。`,
    imagery.length
      ? `- 歌詞意象關鍵字：${imagery.map((h) => `**${h.imagery.name}**（${h.imagery.motif}）`).join("、")}。`
      : "- 歌詞中沒有抓到明顯的具象意象，設計以音樂能量與色彩為主。",
    "",
    "## 現場表演觀察",
    choruses.length
      ? `- 偵測到 ${choruses.length} 段副歌${hookRepeats >= 2 ? `，最常重複的句子出現 ${hookRepeats} 次` : ""}，這些段落最可能是全場大合唱的時刻。`
      : "- 沒有偵測到重複的副歌段落，可能是敘事型的歌，歌詞可以更節制地出現。",
    quiet.length ? `- 安靜段落：${quiet.map((s) => formatTimeShort(s.start)).join("、")}，適合收光、留白或直排文字。` : "- 全曲沒有明顯的安靜段落，注意畫面不要一路滿載。",
    timed ? "- 歌詞已有時間碼，可用軌道模式自動播放；現場仍保留手動 cue。" : "- 歌詞沒有時間碼，建議先在歌詞編輯器打點，或在現場用手動 cue。",
    "",
    "## 設計方向建議",
    `- 先訂下世界觀：以「${imagery[0]?.imagery.motif ?? vocab.motifs[0]}」當主視覺，開場與結尾都回到它。`,
    "- 每一句歌詞都是排好的構圖，不是字幕：主歌小而安靜，副歌才讓歌詞成為畫面主角。",
    "- 歌詞字重 700 以上、對比 4.5:1 以上、每次最多兩行，避開主唱 IMAG 與畫面下緣。",
    "",
    "## 參考來源",
    "- 無（離線模式不做網路搜尋）。",
    "- 啟用 Claude：在首頁的「設定」加入 Anthropic API 金鑰，再重新執行「研究」與「設計」。",
  ].join("\n");

  return { brief, sources: [], engine: "offline", createdAt: new Date().toISOString() };
}
