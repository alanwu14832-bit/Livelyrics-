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
import { FONT_CATALOG, LYRIC_STYLES, SCENES, SECTION_KIND_LABELS } from "./catalog";
import { ensureContrast } from "./color";
import { SILENT_DETAIL, SILENT_TITLE } from "@/lib/silence";
import { buildConcept, chooseSkeleton, conceptKeywords, conceptMotifs, makeTitle, SHORT_SONG_SECONDS, type ConceptContext } from "./concept";
import { capCues, suggestCues } from "./cues";
import { analyzeFindings, type DesignHints, type Findings } from "./findings";
import { findImagery, type ImageryHit } from "./imagery";
import { sensitiveWords } from "./lyric-analysis";
import { normalizePlan } from "./normalize";
import { buildPalette, SCHEMES, type PaletteEntry, type Scheme } from "./palette";
import { analyzeStructure, clamp, meanEnvelope, readingUnits, type SongStructure, type StructSection } from "./structure";
import { EMBLEM_FOR_IMAGERY, generateMotifSvg, hashString, type EmblemStyle } from "./svg";
import { moodPalette, moodScenes } from "./moodboard";
import { combinedMood, placeCollected } from "./collected";
import { chooseVoice, designTypeSystem, typeNotes, type VoiceChoice } from "./type-design";
import { MOOD_VOCABULARY } from "./lexicon/moods";
import { VOICES } from "@/lib/type/vocab";
import type { DesignerInput } from "./types";
import { offlineSceneProgram } from "./scene-program";
import { hueFamily, recentFactor, recentUses, type RecentLook } from "./recent";

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

/**
 * Round 18: the song's hue, moved off a family the library's last songs wore twice already — to the
 * neighbouring family (either side, the less worn first) — so a catalogue of one genre is not three
 * blue songs. An operator's hue is never moved.
 */
export function freshHue(hue: number, looks: readonly RecentLook[] | undefined): number {
  if (!looks?.length) return hue;
  const fam = hueFamily(hue);
  if (recentUses(looks, "palette", fam) < 2) return hue;
  // the nearest family worn fewer than twice (the less worn neighbour first), else the hue stays
  const opts = [-60, 60, -120, 120, 180].map((d) => hue + d);
  const uses = (h: number) => recentUses(looks, "palette", hueFamily(h));
  const near = [opts.slice(0, 2), opts.slice(2, 4), opts.slice(4)].map((ring) => [...ring].sort((a, b) => uses(a) - uses(b))[0]);
  const best = near.find((h) => uses(h) < 2) ?? hue;
  return ((best % 360) + 360) % 360;
}

function makePalette(seed: number, mood: Mood, imagery: ImageryHit[], hueOverride?: number, mono = false, hints?: DesignHints, looks?: readonly RecentLook[]): Palette {
  const top = imagery[0]?.imagery;
  const jitter = ((seed >>> 8) % 21) - 10;
  // the song's strongest image (or its genre's colour tendency) leads; the seed keeps songs apart
  const base = hints?.hue ?? top?.hue ?? null;
  const own = base != null ? base + jitter : seed % 360;
  const hue = hueOverride ?? freshHue(own, looks);
  const shift = hue - own;
  const scheme = hints?.scheme ?? MOOD_SCHEMES[mood.mood][(seed >>> 4) % 2] ?? SCHEMES[0];
  const saturation = mono ? 0 : Math.min(1, MOOD_SATURATION[mood.mood] * (hints ? hints.saturation : (top?.saturation ?? 1)));
  const jittered = hints?.accentHues && hueOverride == null ? ([hints.accentHues[0] + jitter / 2 + shift, hints.accentHues[1] + jitter / 2 + shift] as [number, number]) : undefined;
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

/** Round 18 (m1): the emblem the song's strongest image draws (null when no image leads). */
export function imageryEmblem(f: Findings): EmblemStyle | null {
  const top = f.imagery[0];
  if (!top) return null;
  return EMBLEM_FOR_IMAGERY[top.family.id] ?? top.family.emblem ?? null;
}

/**
 * Round 18 (m1): the 主視覺符號 belongs on the wall (the built-in 「主視覺符號」 scene) only when it
 * says something about this song — the band's own motifs, or the song's strongest image sung often
 * enough — and never when the band has a logo (the logo is its symbol, shown as band media). A
 * generic glyph stays on the key-visual card.
 */
export function symbolOnWall(f: Findings, bible: { motifs: readonly string[] } | null, assets: readonly { kind: string }[] | undefined): boolean {
  if ((assets ?? []).some((a) => a.kind === "logo")) return false;
  return !!bible?.motifs.length || (f.imagery[0]?.weight ?? 0) >= 4;
}

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
  /** round 18: the previous chorus's scene (the next one climbs past it) */
  lastChorus?: SceneId | null;
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
export function chooseClimax(ladder: readonly SceneId[], findings: Findings, seed: number, bandClimax: SceneId | null, calm = false, chorusCount = 2, salt = CLIMAX_SALT, looks?: readonly RecentLook[]): SceneId {
  // a calm song never climaxes on a tunnel or on shards: its biggest chorus is still a quiet
  // picture (particles, the grid's horizon, the waves' bands)
  const base = calm ? [...ladder.filter((sc) => sc !== "tunnel" && sc !== "shards"), "waves" as SceneId] : [...ladder];
  // several choruses need room to climb (round 18: the smallest scene is never the climax of two,
  // or both choruses showed the same picture); three or more climb to one of the bigger scenes
  const lowest = Math.min(...base.map(rankOf));
  // (unless the library's last songs already ended twice on every bigger one)
  const above = base.filter((sc) => rankOf(sc) > lowest && recentUses(looks, "climax", sc) < 2);
  const roomy = chorusCount >= 3 ? base.filter((sc) => rankOf(sc) >= 2) : chorusCount === 2 && above.length ? above : base;
  const pool = (roomy.length ? roomy : base).filter((sc) => sc !== bandClimax);
  const list = pool.length ? pool : roomy.length ? roomy : base;
  if (!list.length) return "particles";
  // a weighted draw: the genre's own scenes count three times, the rest once (so a genre leans
  // but does not lock, and the seed spreads a catalogue of one genre over the ladder)
  const preferred = new Set(findings.genre ? findings.hints.scenes.slice(0, 3) : []);
  // round 18: a climax the library's last songs ended on weighs RECENT_USE_FACTORS by its count
  const weights = list.map((sc) => (preferred.has(sc) ? 3 : 1) * (looks?.length ? recentFactor(looks, "climax", sc) : 1));
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
  // round 18 (m1): a symbol that says nothing about the song never fills the wall
  const own = SCENE_CANDIDATES[kind].filter((sc) => ctx.wantsMotif || sc !== "motif");
  const list = biasScenes(own, ctx.bible).filter((sc) => !hints.avoidScenes.includes(sc) && (ctx.wantsMotif || sc !== "motif"));
  const base = list.length ? list : biasScenes(own, ctx.bible).filter((sc) => ctx.wantsMotif || sc !== "motif");
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
    const top = ladder.length - 1;
    const isLast = ordinal === ctx.chorusCount - 1 && ctx.chorusCount > 1 && e >= 0.65;
    // round 18: the climax is kept for the last chorus (the ones before stop a rung below it), and
    // a chorus never wears the previous chorus's scene again (the ladder climbs, it does not stand still)
    const idx = isLast ? top : Math.min(base + ordinal, ordinal < ctx.chorusCount - 1 && top > 0 ? top - 1 : top);
    let pick = ladder[idx];
    if (isLast) {
      if (pick === prev) pick = ladder[(idx + ladder.length - 1) % ladder.length];
    } else {
      const used = new Set([prev, ctx.lastChorus ?? null]);
      if (used.has(pick)) pick = [...ladder.slice(idx + 1, ordinal < ctx.chorusCount - 1 ? top : undefined), ...ladder.slice(0, idx).reverse()].find((sc) => !used.has(sc)) ?? (pick === prev ? ladder[(idx + ladder.length - 1) % ladder.length] : pick);
    }
    ctx.lastChorus = pick;
    return pick;
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

/** A lyric line short enough to quote in a sentence: the first breath of a long line. */
function clipLine(text: string, max = 10): string {
  const t = text.trim();
  if (readingUnits(t) <= max) return t;
  const first = t.split(/[,，、。！？!?;；]+|(?<=\p{Script=Han})\s+(?=\p{Script=Han})/u).find(Boolean) ?? t;
  if (readingUnits(first) <= max && readingUnits(first) >= 2) return first;
  // cut on a word boundary (Intl.Segmenter), never inside 城市
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: "word" }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  let out = "";
  if (Seg) {
    for (const { segment } of new Seg("zh-Hant", { granularity: "word" }).segment(first)) {
      if (readingUnits(out + segment) > max - 1) break;
      out += segment;
    }
  }
  return `${(out || Array.from(first).slice(0, max - 1).join("")).trim()}…`;
}

/** A line that is only a chant (Hey Hey Hey, Oh oh) is not the one to quote. */
const CHANT_ONLY = /^(?:\s*(?:hey|oh+|yeah|woah|whoa|la+|na+|ooh+)[\s!,.]*)+$/i;

const r2e = (x: number) => x.toFixed(2);

/**
 * Round 20 (M3): why this section looks the way it does, from what the section actually does — its
 * lines (the first one quoted), the energy move from the previous section, the phrase the crowd sings
 * in it, whether the chorus repeats or climbs past the previous one, how the song ends. No sentence
 * shared by every section of every song (「每一句歌詞都是『MV 字卡構圖』」 was).
 */
function sectionRationale(ctx: SectionPlanCtx, list: readonly SectionDesign[], i: number): string {
  const d = list[i];
  const s = ctx.st.sections[i];
  const prev = list[i - 1];
  const next = list[i + 1];
  const sc = SCENES[d.scene].label;
  const hidden = d.lyricStyle === "hidden";
  const sung = ctx.st.lines.length > 0;
  const ids = new Set(s?.lineIds ?? []);
  const lines = ctx.st.lines.filter((l) => ids.has(l.id));
  const n = lines.length;
  // never quote a chant-only line, nor a line with a dark word (round 17)
  const quotes = (l: { text: string }) => !CHANT_ONLY.test(l.text) && sensitiveWords(l.text).length === 0;
  const quotable = lines.find(quotes);
  const first = quotable ? clipLine(quotable.text) : null;
  const last = lines[n - 1] && quotes(lines[n - 1]) ? clipLine(lines[n - 1].text) : null;
  const phrase = ctx.findings.hints.singalong.find((p) => p.lineIds.some((id) => ids.has(id)))?.text ?? null;
  const dur = Math.max(1, Math.round(d.end - d.start));
  const delta = prev ? d.energy - prev.energy : 0;
  const move = !prev ? `能量 ${r2e(d.energy)}` : delta >= 0.15 ? `能量從 ${r2e(prev.energy)} 升到 ${r2e(d.energy)}` : delta <= -0.15 ? `能量從 ${r2e(prev.energy)} 掉到 ${r2e(d.energy)}` : `能量 ${r2e(d.energy)}，和前一段差不多`;
  const earlier = [...list.slice(0, i)].reverse().find((x) => x.kind === d.kind) ?? null;
  const image = ctx.imagery[0]?.imagery.name ?? null;
  const opener = ctx.st.lines.find((l) => l.start != null) ?? ctx.st.lines[0];
  const firstSung = opener && quotes(opener) ? opener : null;
  if (!sung) {
    const big = d.energy >= 0.6;
    switch (d.kind) {
      case "intro":
        return `沒有歌詞的歌從「${sc}」開始，${dur} 秒裡只讓光慢慢出現。`;
      case "outro":
        return d.scene === list[0]?.scene ? `回到開場的「${sc}」，光一點一點收回去。` : `「${sc}」在最後 ${dur} 秒慢慢暗下去，畫面退回安靜。`;
      default:
        return `${d.label}（${move}）交給「${sc}」：${big ? "光跟著鼓點撐滿整面牆" : "畫面跟著樂手的動態慢慢呼吸"}，沒有歌詞要讓位。`;
    }
  }
  switch (d.kind) {
    case "intro":
      if (n) return `一開場就有歌：「${first}」小小地放在「${sc}」上，先不放大。`;
      return `前奏 ${dur} 秒還沒有人聲：「${sc}」先把${image ? `「${image}」的` : "這首歌的"}世界擺出來${firstSung && next?.kind !== "intro" ? `，等「${clipLine(firstSung.text, 8)}」進來` : ""}。`;
    case "verse":
      if (hidden) return `${d.label}以「${sc}」壓低亮度（${move}）；這段不放歌詞，把焦點留給主唱。`;
      if (d.lyricStyle === "subtitle") return `${d.label}字很密（${n} 句），畫面「${sc}」為主、歌詞退到小字幕，不和主唱搶戲。`;
      if (earlier) {
        const same = earlier.scene === d.scene;
        return `${d.label}回到敘事${same ? `，仍是「${sc}」` : `，換成「${sc}」`}：${n} 句${first ? `從「${first}」接下去` : ""}，${d.energy > earlier.energy + 0.05 ? "比上一段主歌亮一點" : "和上一段主歌一樣收著"}。`;
      }
      return `${n} 句主歌${first ? `從「${first}」說起` : ""}，「${sc}」壓在${d.energy < 0.45 ? "低" : "中低"}亮度（${move}），字小、放在主唱旁邊，不擋 IMAG。`;
    case "pre-chorus":
      return `導歌 ${n ? `${n} 句` : `${dur} 秒`}把張力往上推（${move}），「${sc}」一層層堆起來${next?.kind === "chorus" ? `，先不放出副歌「${SCENES[next.scene].label}」的顏色` : ""}。`;
    case "chorus": {
      const words = hidden ? "這段不放歌詞，讓光與節拍帶動全場" : phrase ? `「${phrase}」放大成畫面的主角，邀請全場合唱` : `${n} 句歌詞${first ? `（從「${first}」起）` : ""}放大成畫面的主角`;
      const total = list.filter((x) => x.kind === "chorus").length;
      const ordinal = list.slice(0, i).filter((x) => x.kind === "chorus").length;
      if (!earlier) return `第一次副歌（${move}）：「${sc}」打開整面牆，${words}。`;
      const climb = earlier.scene === d.scene ? `仍是「${sc}」，強度從 ${r2e(earlier.sceneParams.intensity)} 推到 ${r2e(d.sceneParams.intensity)}` : `從${earlier.label}的「${SCENES[earlier.scene].label}」換到「${sc}」`;
      if (ordinal === total - 1) {
        // only a chorus that really is the loudest is called the top; a last chorus sung softer says so
        if (d.energy < earlier.energy - 0.1) return `最後一次副歌反而收著（${move}）：「${sc}」放低亮度，${hidden ? "不放歌詞" : phrase ? `「${phrase}」輕輕再唱一次` : "歌詞不再放大"}。`;
        const top = d.energy >= Math.max(...list.map((x) => x.energy)) - 0.05;
        return `${top ? "最後一次副歌是全曲的頂點" : "最後一次副歌"}：${climb}，${hidden ? "不放歌詞" : phrase ? `「${phrase}」再放大一次` : "歌詞再放大一次"}。`;
      }
      return `${d.label}${climb}，${words}。`;
    }
    case "bridge":
      return `橋段轉個方向：「${sc}」換掉前面的語彙${hidden || !n ? "，不放歌詞" : `，${n} 句歌詞${first ? `（「${first}」）` : ""}換一種構圖`}，製造轉折。`;
    case "breakdown":
      return `${move}：「${sc}」幾乎只剩留白，${hidden || !n ? "不放歌詞" : `只留 ${n} 句小字${first ? `「${first}」` : ""}`}，讓舞台燈光說話。`;
    case "solo":
    case "interlude":
      return `${dur} 秒的${SECTION_KIND_LABELS[d.kind]}交給「${sc}」與燈光，${d.energy >= 0.6 ? "畫面跟著鼓點爆開" : "畫面跟著節拍呼吸"}，歌詞隱藏。`;
    case "outro": {
      const words = hidden || !n ? "歌詞留白" : last ? `最後一句「${last}」放大淡出` : "最後一句淡出";
      if (d.scene === "motif") return `回到主視覺「${sc}」收尾，和開場呼應；${words}。`;
      if (d.scene === list[0]?.scene) return `回到開場的「${sc}」，首尾呼應；${words}。`;
      return `「${sc}」在最後 ${dur} 秒慢慢暗下去，${words}${image && (hidden || !last) ? `，只剩「${image}」` : ""}。`;
    }
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
  const list: SectionDesign[] = st.sections.map((s, i) => {
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
      rationale: "",
    };
  });
  // the rationale reads the neighbours (the energy move, the previous chorus, the opening scene)
  return list.map((d, i) => ({ ...d, rationale: sectionRationale(ctx, list, i) }));
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
    if (hook && short && (chant || l.cluster === ctx.st.hookCluster) && sec.lyricStyle !== "impact" && !dark.length) {
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
    else if (s === peak && !st.flat) parts.push(`${t} 最高點（${s.energy.toFixed(2)}）`);
    else if (prev && s.energy - prev.energy >= 0.25) parts.push(`${t} 衝上${SECTION_KIND_LABELS[s.kind]}（${s.energy.toFixed(2)}）`);
    else if (prev && prev.energy - s.energy >= 0.25) parts.push(`${t} 回落（${s.energy.toFixed(2)}）`);
  });
  const end = st.sections[st.sections.length - 1];
  if (st.flat) parts.push("音量一路差不多，沒有真正的高潮");
  parts.push(`${formatTimeShort(end.end)} 結束`);
  return parts.join(" → ");
}

/**
 * Round 20 (M3): the arc in words from the plan itself — the scenes the choruses actually wear (and
 * whether they really get brighter / faster), the brightest section without a chorus, and how the
 * song really ends (back to the symbol, back to the opening scene, fading, or cut on a chorus).
 */
function arcStory(sections: readonly SectionDesign[], flat: boolean, phrase: string | null, image: string | null, lastLine: string | null): string {
  const label = (s: SectionDesign) => `${s.label}「${SCENES[s.scene].label}」`;
  const choruses = sections.filter((s) => s.kind === "chorus");
  const parts: string[] = [];
  if (choruses.length >= 2) {
    const a = choruses[0];
    const z = choruses[choruses.length - 1];
    const brighter = z.sceneParams.intensity > a.sceneParams.intensity + 0.01;
    const faster = z.sceneParams.speed > a.sceneParams.speed + 0.02;
    const same = choruses.every((c) => c.scene === a.scene);
    const softer = z.sceneParams.intensity < a.sceneParams.intensity - 0.01;
    const climb = brighter && faster ? "一次比一次更亮、更快" : brighter ? "一次比一次更亮" : softer ? "最後一次反而收著唱" : "每一次都一樣滿";
    const sung = phrase ? `，「${phrase}」${softer ? "最後輕輕唱" : "每次都更大"}` : "";
    parts.push(same ? `${choruses.length} 次副歌都是「${SCENES[a.scene].label}」，${climb}${sung}` : `副歌從${choruses.map(label).join("到")}，${climb}${sung}`);
  } else if (choruses.length === 1) {
    const peak = sections.reduce((p, s) => (s.energy > p.energy ? s : p), sections[0]);
    parts.push(peak === choruses[0] || flat ? `只有一次副歌，${label(choruses[0])}是全曲最亮的一段` : `只有一次副歌（${label(choruses[0])}），最亮的反而是${label(peak)}`);
  } else if (!flat) {
    const peak = sections.reduce((p, s) => (s.energy > p.energy ? s : p), sections[0]);
    parts.push(`沒有重複的副歌，最亮的是${label(peak)}`);
  } else parts.push("沒有一段特別亮，畫面維持同一種呼吸");
  const end = sections[sections.length - 1];
  const open = sections[0];
  if (end.kind === "outro" || end.energy < 0.4) {
    if (end.scene === "motif") parts.push(`${end.label}回到主視覺符號收尾`);
    else if (end !== open && end.scene === open.scene) parts.push(`${end.label}回到開場的「${SCENES[end.scene].label}」，首尾呼應`);
    else parts.push(`${end.label}讓「${SCENES[end.scene].label}」${lastLine ? `在「${lastLine}」之後` : image ? `帶著「${image}」` : ""}慢慢暗下去`);
  } else parts.push(`歌停在${label(end)}最滿的時候，最後一拍直接全黑`);
  return `${parts.join("；")}。`;
}

/** The song's last line fit to quote (no chant-only line, no dark word), clipped. */
function lastQuotable(ctx: SectionPlanCtx): string | null {
  const l = [...ctx.st.lines].reverse().find((x) => !CHANT_ONLY.test(x.text) && sensitiveWords(x.text).length === 0);
  return l ? clipLine(l.text, 8) : null;
}

/** 「（從『窗外的雨還在下』開始）」 for the notes' verse row. */
function verseLead(ctx: SectionPlanCtx, verse: SectionDesign): string {
  const idx = ctx.st.sections.findIndex((s) => s.start === verse.start);
  const id = ctx.st.sections[idx]?.lineIds[0];
  const ids = new Set(ctx.st.sections[idx]?.lineIds ?? (id ? [id] : []));
  const line = ctx.st.lines.find((l) => ids.has(l.id) && !CHANT_ONLY.test(l.text) && sensitiveWords(l.text).length === 0);
  return line ? `（從「${clipLine(line.text)}」開始）` : "";
}

function designerNotes(ctx: SectionPlanCtx, sections: SectionDesign[], title: string, typeSystem?: DesignPlan["typeSystem"]): string {
  const choruses = sections.filter((s) => s.kind === "chorus");
  const hidden = sections.filter((s) => s.lyricStyle === "hidden");
  const verse = sections.find((s) => s.kind === "verse");
  const silent = ctx.st.silent;
  const short = ctx.st.duration < SHORT_SONG_SECONDS || silent;
  const lines = [
    ...(silent ? [`## ${SILENT_TITLE}`, SILENT_DETAIL, ""] : []),
    ...(short && !silent ? ["## 音檔太短，分析不可靠", `這段音檔只有 ${Math.round(ctx.st.duration)} 秒：速度、段落與能量都讀不準，所以只設計一個安靜的單一畫面，不閃、不切。上傳完整的音檔後再重新設計。`, ""] : []),
    "## 敘事弧線",
    short
      ? `整段用主視覺「${title}」一個畫面撐住，沒有段落變化。`
      : `「${title}」從${sections[0].label}的「${SCENES[sections[0].scene].label}」開始：${arcDescription(ctx.st)}。${arcStory(sections, ctx.st.flat, ctx.findings.hints.singalong[0]?.text ?? null, ctx.imagery[0]?.imagery.name ?? null, lastQuotable(ctx))}`,
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
              ? `- 主歌${verseLead(ctx, verse)}：歌詞是小而安靜的構圖、畫面「${SCENES[verse.scene].label}」保持低調，把焦點留給主唱。`
              : `- 主歌：歌詞「${LYRIC_STYLES[verse.lyricStyle].label}」、畫面「${SCENES[verse.scene].label}」保持低調，把焦點留給主唱。`
            : "- 敘事段落：畫面保持低調，把焦點留給主唱。",
          choruses.length
            ? typeSystem
              ? `- 副歌（${choruses.length} 次）：${choruses.map((c) => `${c.label}「${SCENES[c.scene].label}」`).join("、")}，歌詞放大成畫面的主角，${ctx.findings.hints.singalong[0] ? `「${ctx.findings.hints.singalong[0].text}」每次都用同一個構圖` : "重複的句子沿用同一個構圖"}讓觀眾跟唱。`
              : `- 副歌（${choruses.length} 次）：${choruses.map((c) => `${c.label}「${LYRIC_STYLES[c.lyricStyle].label}」`).join("、")}，重複的句子讓觀眾跟唱。`
            : short
              ? silent
                ? "- 音檔幾乎沒有聲音，沒有段落可言：歌詞小而安靜地出現。"
                : "- 音檔太短，沒有段落可言：歌詞小而安靜地出現。"
              : "- 沒有偵測到重複的副歌，能量最高的段落以大字呈現。",
          hidden.length
            ? `- ${hidden.map((h) => `${h.label}（「${SCENES[h.scene].label}」）`).join("、")}不放歌詞，讓「${title}」的畫面與燈光當主角。`
            : "- 每段都有歌詞，注意畫面不要過度繁忙。",
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
  // round 20: one mood (the lyrics and the audio reconciled; the overruled reading is named, not listed as a second mood)
  if (ctx.st.lines.length && f.lyrics.emotion.hits > 0) rows.push(`- 情緒：${f.mood.label}（${f.mood.why}）；人稱 ${f.lyrics.pov.label}。`);
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
  // round 20: the genre's live habit lands one bar before the first chorus (the loudest section without
  // one), read from this song's structure — not 2 s before the audio's peak, which every song shared
  const chorus = sections.find((s) => s.kind === "chorus");
  const anchor = chorus ?? (f.audio.peakAt != null ? sections.find((s) => Math.abs(s.start - (f.audio.peakAt as number)) < 0.6) : undefined);
  if (f.genre && anchor && st.duration >= SHORT_SONG_SECONDS && (st.lines.length > 0 || !mentionsSinger)) {
    const bar = f.audio.bpm > 0 ? (4 * 60) / f.audio.bpm : 2;
    const time = Math.max(0, Math.round((anchor.start - bar) * 100) / 100);
    out.push({ time, title: `${anchor.label}前：${f.genre.label}的現場`, detail: f.genre.live.slice(0, 240), kind: "highlight" });
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
  if (!(st.duration < SHORT_SONG_SECONDS || st.silent) || st.sections.length <= 1) return st;
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
  const palette: Palette = fromBible ?? fromMood ?? makePalette(seed, mood, imagery, options.hue, options.mono, hints, input.recentLooks);
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
    voice: chooseVoice(findings, st.cjk, input.recentLooks),
    calm: isCalmSong(findings),
    climax: "tunnel",
    bandClimax: input.bandSongs?.[0]?.chorusScene ?? null,
    wantsMotif: symbolOnWall(findings, bible, input.assets),
    opening: null,
  };
  ctx.climax = chooseClimax(
    SCENE_CANDIDATES.chorus.filter((sc) => !(bible?.sceneAvoid ?? []).includes(sc) && !hints.avoidScenes.includes(sc)),
    findings,
    seed,
    ctx.bandClimax,
    ctx.calm,
    ctx.chorusCount,
    CLIMAX_SALT,
    input.recentLooks,
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
  const moodKeywords = conceptKeywords(findings);
  // round 18 (m1): the symbol is drawn from the song's own strongest image when its words name one
  const emblem = imageryEmblem(findings) ?? hints.emblem ?? MOOD_EMBLEM[mood.mood];
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
    program: true,
    recentLooks: input.recentLooks,
  });
  // round 18: the key visual names the fonts the words are set in (a fresh pair when the library wore this one)
  const typo = bible || (typeSystem.fonts.cjk === typography.cjkFont && typeSystem.fonts.latin === typography.latinFont) ? typography : { ...typography, cjkFont: typeSystem.fonts.cjk, latinFont: typeSystem.fonts.latin, rationale: `${FONT_CATALOG[typeSystem.fonts.cjk].label}＋${FONT_CATALOG[typeSystem.fonts.latin].label}：${VOICES[typeSystem.voice].label}的字，和片庫最近幾首歌錯開；字重 ${typography.weight} 在 LED 上也清楚。` };
  const plan: DesignPlan = {
    version: 1,
    keyVisual: {
      title,
      concept,
      moodKeywords,
      palette: palette.entries,
      motifs: motifs.length >= 2 ? motifs : [...motifs, ...MOOD_VOCABULARY[findings.audio.quadrant].motifs].filter((m, i, a) => a.indexOf(m) === i).slice(0, 4),
      motifSvg: generateMotifSvg(`${input.meta?.title ?? ""}|${input.meta?.artist ?? ""}`, emblem),
      typography: typo,
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
    ...(st.silent
      ? [`> **${SILENT_TITLE}**：${SILENT_DETAIL}`]
      : st.duration < SHORT_SONG_SECONDS
        ? [`> **音檔太短，分析不可靠**：只有 ${Math.round(st.duration)} 秒，請上傳完整的音檔再重新設計。`]
        : []),
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
