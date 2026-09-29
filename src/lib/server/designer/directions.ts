// 提出設計方向 (phase 4): 2–3 clearly different directions for one song, the way a stage-visual
// designer pitches a band before producing anything.
//
// A direction is first a compact spec (name, pitch, rationale, palette, typography, scene
// families per section kind, lyric treatment per section kind, texture, energy); `expandDirection`
// turns it into a full DesignPlan on the song's real structure (the offline designer's timing,
// media, lines and cues, then the direction's choices on top) and normalizes it. Claude writes
// the specs in one structured-output call (cheap: no per-section plans); the offline designer
// writes three deterministic ones on the warm / cool / monochrome axes. Both respect the band's
// visual bible as a hard constraint (its palette, fonts, avoided scenes and lyric policy).
// 字體藝術: every direction speaks its own typographic voice (日系 MV 字卡, 電影片頭／動態海報, 書法與
// 水墨, 實驗／故障感 — never two alike), and its plan carries the type system with a composition for
// every sung line, so the style frames and the proposal show compositions, not subtitles.

import { z } from "zod";
import { paletteRoles } from "@/lib/show";
import { moodSummary, type MoodSummary } from "@/lib/moodboard";
import {
  AUTO_LYRIC_STYLE_IDS,
  AutoLyricStyleIdSchema,
  FontIdSchema,
  LYRIC_PLACEMENTS,
  LyricPlacementSchema,
  MEDIA_TREATMENTS,
  MediaTreatmentSchema,
  SCENE_IDS,
  SECTION_KINDS,
  SceneIdSchema,
  SectionKindSchema,
  TYPE_VOICE_IDS,
  TypeVoiceIdSchema,
} from "@/lib/schema";
import type {
  DesignDirection,
  DesignPlan,
  DirectionEngine,
  DirectionReference,
  KeyVisual,
  LyricPlacement,
  LyricStyleId,
  MediaTreatment,
  MoodImage,
  SceneId,
  SectionDesign,
  SectionKind,
  TypeParams,
  TypeVoiceId,
} from "@/lib/types";
import { DIRECTION_LETTERS, MAX_DIRECTIONS, MIN_DIRECTIONS } from "@/lib/directions";
import { formatTimeShort } from "@/lib/timeline";
import { activeBible, applyLyricPolicy, biblePalette } from "./bible-style";
import { FONT_CATALOG, LYRIC_STYLES, SCENES, SECTION_KIND_LABELS } from "./catalog";
import { colorName, contrastRatio, ensureContrast, hexToHsl, hsl, hueDistance, luminance, normalizeHex } from "./color";
import { analyzeFindings, type Findings } from "./findings";
import { moodPalette, moodboardBlock } from "./moodboard";
import { normalizePlan } from "./normalize";
import { offlineDesign } from "./offline";
import { buildPalette, type PaletteEntry } from "./palette";
import { analysisSummary, bibleBlock, catalogBlock, lyricExcerpt, songBlock, trimBrief } from "./prompts";
import { analyzeStructure, clamp } from "./structure";
import { EMBLEM_STYLES, generateMotifSvg, hashString, type EmblemStyle } from "./svg";
import { chooseVoice, designTypeSystem, topRecipes } from "./type-design";
import { directionSceneProgram } from "./scene-program";
import type { DesignRequest } from "./types";
import { RECIPES, VOICES } from "@/lib/type/vocab";

// ---------------------------------------------------------------------------
// the compact spec
// ---------------------------------------------------------------------------

export type Motion = "soft" | "punchy";

export interface DirectionSpec {
  name: string;
  pitch: string;
  rationale: string;
  references: DirectionReference[];
  moodKeywords: string[];
  palette: PaletteEntry[];
  typography: KeyVisual["typography"];
  motifs: string[];
  emblem: EmblemStyle;
  /** scene families per section kind, most typical first (choruses climb the list) */
  scenes: Partial<Record<SectionKind, SceneId[]>>;
  sceneTendency: string;
  lyrics: Partial<Record<SectionKind, { style: LyricStyleId; placement: LyricPlacement }>>;
  lyricTreatment: string;
  /** 字體藝術: the direction's typographic voice (each direction a different one) */
  typeVoice: TypeVoiceId;
  /** preferred treatments for band media */
  treatments: MediaTreatment[];
  /** 0..1 overall intensity of the look */
  energy: number;
  motion: Motion;
}

const KINDS = SECTION_KINDS;

// ---------------------------------------------------------------------------
// offline: three archetypes on the warm / cool / monochrome axes
// ---------------------------------------------------------------------------

interface Archetype {
  key: "film" | "collage" | "minimal";
  /** typographic voices that suit the look, the most fitting first */
  voices: TypeVoiceId[];
  scenes: Record<SectionKind, SceneId[]>;
  lyrics: Record<SectionKind, { style: LyricStyleId; placement: LyricPlacement }>;
  typography: Omit<KeyVisual["typography"], "rationale">;
  treatments: MediaTreatment[];
  energy: number;
  motion: Motion;
  emblem: EmblemStyle;
}

const FILM: Archetype = {
  key: "film",
  voices: ["mv-card", "title-sequence", "ink", "glitch"],
  scenes: {
    intro: ["bokeh", "nebula"],
    verse: ["rain", "waves", "nebula"],
    "pre-chorus": ["waves", "particles"],
    chorus: ["particles", "waves", "bokeh"],
    bridge: ["rain", "nebula"],
    solo: ["waves", "particles"],
    breakdown: ["rain", "gradient"],
    outro: ["bokeh", "gradient"],
    interlude: ["nebula", "rain"],
  },
  // the legacy fallback styles (字體藝術 composes every line); only sections with lyrics use them
  lyrics: {
    intro: { style: "line-fade", placement: "upper-third" },
    verse: { style: "line-fade", placement: "upper-third" },
    "pre-chorus": { style: "typewriter", placement: "center" },
    chorus: { style: "line-fade", placement: "center" },
    bridge: { style: "vertical", placement: "vertical-right" },
    solo: { style: "line-fade", placement: "upper-third" },
    breakdown: { style: "line-fade", placement: "center" },
    outro: { style: "line-fade", placement: "center" },
    interlude: { style: "line-fade", placement: "upper-third" },
  },
  typography: { cjkFont: "noto-serif-tc", latinFont: "playfair-display", weight: 700, letterSpacing: 0.08 },
  treatments: ["grain-film", "slow-drift", "blur-glow"],
  energy: 0.45,
  motion: "soft",
  emblem: "orbit",
};

const COLLAGE: Archetype = {
  key: "collage",
  voices: ["title-sequence", "glitch", "mv-card", "ink"],
  scenes: {
    intro: ["motif", "shards"],
    verse: ["shards", "grid", "particles"],
    "pre-chorus": ["grid", "particles"],
    chorus: ["shards", "grid", "tunnel"],
    bridge: ["motif", "ink"],
    solo: ["tunnel", "shards"],
    breakdown: ["motif", "gradient"],
    outro: ["motif", "shards"],
    interlude: ["grid", "motif"],
  },
  lyrics: {
    intro: { style: "word-pop", placement: "center" },
    verse: { style: "word-pop", placement: "left" },
    "pre-chorus": { style: "word-pop", placement: "center" },
    chorus: { style: "impact", placement: "center" },
    bridge: { style: "stack", placement: "left" },
    solo: { style: "word-pop", placement: "center" },
    breakdown: { style: "impact", placement: "center" },
    outro: { style: "impact", placement: "center" },
    interlude: { style: "word-pop", placement: "center" },
  },
  typography: { cjkFont: "chiron-hei-hk", latinFont: "anton", weight: 900, letterSpacing: 0.02 },
  treatments: ["halftone", "beat-cut", "duotone"],
  energy: 0.88,
  motion: "punchy",
  emblem: "shard",
};

const MINIMAL: Archetype = {
  key: "minimal",
  voices: ["ink", "mv-card", "title-sequence", "glitch"],
  scenes: {
    intro: ["gradient", "motif"],
    verse: ["gradient", "ink"],
    "pre-chorus": ["ink", "gradient"],
    chorus: ["ink", "motif", "particles"],
    bridge: ["gradient", "ink"],
    solo: ["ink", "motif"],
    breakdown: ["blackout", "gradient"],
    outro: ["gradient", "motif"],
    interlude: ["ink", "gradient"],
  },
  lyrics: {
    intro: { style: "typewriter", placement: "center" },
    verse: { style: "line-fade", placement: "upper-third" },
    "pre-chorus": { style: "typewriter", placement: "center" },
    chorus: { style: "stack", placement: "center" },
    bridge: { style: "vertical", placement: "vertical-left" },
    solo: { style: "typewriter", placement: "center" },
    breakdown: { style: "typewriter", placement: "center" },
    outro: { style: "typewriter", placement: "center" },
    interlude: { style: "typewriter", placement: "center" },
  },
  typography: { cjkFont: "noto-sans-tc", latinFont: "space-grotesk", weight: 800, letterSpacing: 0.12 },
  treatments: ["duotone", "mask-lyrics"],
  energy: 0.35,
  motion: "soft",
  emblem: "crystal",
};

const AXES = [FILM, COLLAGE, MINIMAL] as const;

/**
 * One typographic voice per direction, never two alike: the song's own voice goes to the look that
 * suits it best (MV 字卡 → film, 片頭海報 or 故障 → collage, 水墨 → minimal); the other looks take the
 * first voice of their own preference that is still free (no brush calligraphy for Latin lyrics).
 */
export function directionVoices(native: TypeVoiceId, cjk: boolean): [TypeVoiceId, TypeVoiceId, TypeVoiceId] {
  const own: TypeVoiceId = !cjk && native === "ink" ? "mv-card" : native;
  let home = 0;
  AXES.forEach((a, i) => {
    if (a.voices.indexOf(own) < AXES[home].voices.indexOf(own)) home = i;
  });
  const out: Array<TypeVoiceId | null> = [null, null, null];
  out[home] = own;
  const used = new Set<TypeVoiceId>([own]);
  AXES.forEach((a, i) => {
    if (out[i]) return;
    const pick = a.voices.find((v) => !used.has(v) && (cjk || v !== "ink")) ?? a.voices.find((v) => !used.has(v)) ?? a.voices[0];
    out[i] = pick;
    used.add(pick);
  });
  return out as [TypeVoiceId, TypeVoiceId, TypeVoiceId];
}

/** How a direction sets its lyrics, in its voice (繁中, one or two sentences). */
function voiceTreatment(voice: TypeVoiceId, phrase: string | null): string {
  switch (voice) {
    case "mv-card":
      return `日系 MV 字卡：每一句都是一張排好的字卡，巨字與小字的極端對比、直橫混排與大量留白，在拍點上硬切${phrase ? `；「${phrase}」放到最大` : ""}。`;
    case "title-sequence":
      return `電影片頭／動態海報：字就是形狀——出血的巨字、網格、細線與編號，遮罩擦出${phrase ? `；「${phrase}」撐滿畫面` : ""}。`;
    case "ink":
      return `書法與水墨：楷書依筆順一個字一個字寫出來，直排為主，暈染與飛白，一方紅印${phrase ? `；「${phrase}」寫得最大` : ""}。`;
    case "glitch":
      return `實驗／故障感：切片、錯位、RGB 分離與殘影，字被畫面吃掉一部分，拍點上抖動（在 LED 安全的閃爍限制內）${phrase ? `；「${phrase}」撕開再重組` : ""}。`;
  }
}

function entriesOf(roles: Array<[string, string]>): PaletteEntry[] {
  const seen = new Set<string>();
  const out: PaletteEntry[] = [];
  for (const [hex, role] of roles) {
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push({ hex, role, name: colorName(hex) });
  }
  return out;
}

/** Warm or cool film look: analogous, desaturated; the mood board's own colours when there are any, else the song's warmest / coolest image. */
function filmPalette(mood: MoodSummary | null, warm: boolean, songHue: number | null): PaletteEntry[] {
  const fromMood = moodPalette(mood);
  if (fromMood) return fromMood.entries;
  return buildPalette({ hue: songHue ?? (warm ? 28 : 208), scheme: "analogous", saturation: 0.48, brightness: 0.45 });
}

/** Saturated collage: the mood board's most vivid hue (else the song's most vivid image, else a hot red-orange), complementary, full saturation. */
function collagePalette(mood: MoodSummary | null, songHue: number | null = null): PaletteEntry[] {
  if (mood?.vivid) {
    const v = hexToHsl(mood.vivid);
    const primary = v.l >= 0.35 && v.l <= 0.7 ? mood.vivid : hsl(v.h, Math.max(0.75, v.s), 0.52);
    const accent = hsl(v.h + 165, 0.9, 0.58);
    const highlight = hsl(v.h + 50, 0.95, 0.66);
    const bg = hsl(v.h + 200, 0.6, 0.06);
    return entriesOf([
      [bg, "背景"],
      [primary, "主色"],
      [accent, "點綴"],
      [ensureContrast(hsl(v.h, 0.2, 0.96), bg, []), "歌詞"],
      [highlight, "高光"],
      [hsl(v.h, 0.5, 0.08), "對比背景"],
    ]);
  }
  return buildPalette({ hue: songHue ?? 12, scheme: "complementary", saturation: 0.98, brightness: 0.7 });
}

/** Black and white with one accent: the mood board's vivid colour, else the song's image colour, else a single signal red. */
function minimalPalette(mood: MoodSummary | null, songHue: number | null = null): PaletteEntry[] {
  const accent = mood?.vivid && hexToHsl(mood.vivid).s >= 0.2 ? mood.vivid : songHue != null ? hsl(songHue, 0.72, 0.56) : "#e5483b";
  return entriesOf([
    ["#060607", "背景"],
    ["#8a8a8f", "主色"],
    [accent, "點綴"],
    ["#f4f4f2", "歌詞"],
    ["#d6d6d3", "高光"],
    ["#141416", "對比背景"],
  ]);
}

function refsFor(moodboard: readonly MoodImage[] | undefined, mood: MoodSummary | null, cue: string): DirectionReference[] {
  if (!mood) return [];
  const list = moodboard ?? [];
  // the images whose own palette carries the colours this direction took
  const picked = list.filter((m) => m.stats?.palette.some((h) => mood.vivid && hueDistance(hexToHsl(h).h, hexToHsl(mood.vivid).h) < 25 && hexToHsl(h).s > 0.15));
  return (picked.length ? picked : list.filter((m) => m.stats)).slice(0, 3).map((m) => ({ imageId: m.id, cue }));
}

function withRationale(font: Omit<KeyVisual["typography"], "rationale">, why: string): KeyVisual["typography"] {
  return { ...font, rationale: `${FONT_CATALOG[font.cjkFont].label}＋${FONT_CATALOG[font.latinFont].label}：${why}` };
}

function imageList(moodboard: readonly MoodImage[] | undefined, refs: readonly DirectionReference[]): string {
  const idx = new Map((moodboard ?? []).map((m, i) => [m.id, i + 1]));
  const nums = refs.map((r) => idx.get(r.imageId)).filter((n): n is number => n != null);
  return nums.length ? nums.map((n) => `圖 ${n}`).join("、") : "";
}

function isWarmHue(h: number): boolean {
  const x = ((h % 360) + 360) % 360;
  return x < 70 || x >= 300;
}

/** The hue of the song's first image family of this temperature (the palette follows the lyrics). */
function imageHue(f: Findings, pick: (x: Findings["imagery"][number]) => boolean): number | null {
  const hit = f.imagery.slice(0, 5).find(pick);
  return hit ? hit.family.hues[0] : null;
}

/**
 * The first of the song's images (most vivid first, or most weight) whose colour is at least 40°
 * from every hue taken; images of the `prefer` temperature first (a cool film gets a warm collage).
 */
function distinctImage(f: Findings, taken: ReadonlyArray<number | null>, order: "vivid" | "weight", prefer?: "warm" | "cool"): Findings["imagery"][number] | null {
  const list = [...f.imagery.slice(0, 6)];
  if (order === "vivid") list.sort((x, y) => y.family.saturation * y.weight - x.family.saturation * x.weight);
  const ok = (h: Findings["imagery"][number]) => taken.every((t) => t == null || hueDistance(h.family.hues[0], t) >= 40);
  return (prefer ? list.find((h) => h.family.temperature === prefer && ok(h)) : undefined) ?? list.find(ok) ?? null;
}

/** Song-specific scenes on an archetype's axis: the song's own scene family moves first where the axis allows it. */
function tailorScenes(base: Record<SectionKind, SceneId[]>, f: Findings, allowed: readonly SceneId[]): Record<SectionKind, SceneId[]> {
  const song = f.hints.scenes.filter((sc) => allowed.includes(sc) && !f.hints.avoidScenes.includes(sc)).slice(0, 2);
  const out = { ...base };
  for (const k of ["verse", "pre-chorus", "bridge", "interlude"] as const) {
    const lead = song.find((sc) => base[k].includes(sc) || allowed.includes(sc));
    if (lead) out[k] = [lead, ...base[k].filter((sc) => sc !== lead)].slice(0, 3);
  }
  return out;
}

const FILM_SCENES: readonly SceneId[] = ["nebula", "rain", "waves", "bokeh", "gradient", "particles"];
const COLLAGE_SCENES: readonly SceneId[] = ["shards", "grid", "tunnel", "particles", "motif", "ink"];
const MINIMAL_SCENES: readonly SceneId[] = ["gradient", "ink", "motif", "blackout"];

/** The film axis's serif by genre: warmer hand-written kai for folk / city pop / dream pop, old-style for jazz. */
function filmFont(f: Findings): Omit<KeyVisual["typography"], "rationale"> {
  const id = f.genre?.id;
  if (id === "folk" || id === "city-pop" || id === "dream-pop") return { ...FILM.typography, cjkFont: "lxgw-wenkai-tc" };
  if (id === "jazz") return { ...FILM.typography, cjkFont: "cactus-classical-serif" };
  return FILM.typography;
}

/**
 * Three deterministic, clearly different directions (film / collage / minimal), made for this song
 * from the free-research findings: the palettes take the song's own image colours (without a mood
 * board), the scene families its imagery and genre, the pitch and rationale its genre, audio mood,
 * emotion, point of view and sing-along phrase. Without a bible: cool (or warm, after the mood board
 * or the song's warm imagery) desaturated film, a saturated complementary collage, and black-and-white
 * with one accent. With a bible: its palette and fonts for all three (a different role leads in
 * each), avoided scenes never used, its lyric policy applied on expansion.
 */
export function offlineDirectionSpecs(req: DesignRequest): DirectionSpec[] {
  const bible = activeBible(req.bible);
  const bp = biblePalette(bible);
  const mood = moodSummary(req.moodboard ?? []);
  const f = analyzeFindings(req);
  const genre = f.genre;
  // the axis this genre's own grammar lives on: its direction takes the genre's colours and lyric habits
  const nativeAxis: "film" | "collage" | "minimal" | null = !genre
    ? null
    : genre.motion === "soft"
      ? "film"
      : genre.motion === "punchy"
        ? "collage"
        : genre.lyrics.density === "sparse" || genre.id === "post-punk"
          ? "minimal"
          : null;
  const genreColours = !!genre && !mood && !bp;
  const warm = mood ? mood.warmth > 0.08 : nativeAxis === "film" && genre ? isWarmHue(genre.palette.hues[0]) : f.hints.temperature === "warm";
  const briefHint = req.research?.engine === "claude" || req.research?.engine === "manual-claude" ? "延續研究簡報的方向，" : "";
  const names = f.imagery.slice(0, 2).map((h) => `「${h.family.name}」`);
  const imageryText = names.length ? `歌詞裡的${names.join("與")}` : "歌曲的能量起伏";
  const phrase = f.hints.singalong.find((p) => !p.chant)?.text ?? f.hints.singalong[0]?.text ?? null;
  const sung = (req.lyrics?.lines ?? []).some((l) => l.text.trim());
  const genreLyrics = (axis: "film" | "collage" | "minimal") => (genre && axis === nativeAxis && sung ? `${genre.label}：${genre.lyrics.note}。` : "");
  // 字體藝術: three different typographic voices, the song's own on the look that suits it
  const cjk = analyzeStructure(req).cjk;
  const [filmVoice, collageVoice, minimalVoice] = directionVoices(chooseVoice(f, cjk).voice, cjk);
  const native = (axis: "film" | "collage" | "minimal") => {
    if (!genre) return "";
    const soft = genre.motion === "soft";
    const hit = axis === "film" ? soft : axis === "collage" ? genre.motion === "punchy" : genre.lyrics.density === "sparse" || genre.id === "post-punk";
    return hit ? `這是最貼近${genre.label}的做法：${genre.why}` : `${genre.label}的歌用這個方向，是刻意的反差。`;
  };
  const findingsText = `免費研究：${genre ? `曲風「${genre.label}」（${f.genres[0].evidence[0] ?? "公開資料"}）、` : ""}音訊「${f.audio.label}」${sung && f.lyrics.emotion.hits ? `、歌詞情緒「${f.lyrics.emotion.label}」、人稱${f.lyrics.pov.label}` : ""}。`;
  const avoid = new Set([...(bible?.sceneAvoid ?? []), ...f.hints.avoidScenes]);
  const scenesOf = (a: Archetype, allowed: readonly SceneId[], preferBible: boolean): Partial<Record<SectionKind, SceneId[]>> => {
    const tailored = bible?.sceneAffinity.length ? a.scenes : tailorScenes(a.scenes, f, allowed);
    const out: Partial<Record<SectionKind, SceneId[]>> = {};
    for (const k of KINDS) {
      let list = tailored[k].filter((s) => !avoid.has(s));
      if (preferBible && bible?.sceneAffinity.length) list = [...bible.sceneAffinity.filter((s) => !avoid.has(s) && (SCENES[s].energy[1] >= 0.5 || k !== "chorus")), ...list].filter((s, i, arr) => arr.indexOf(s) === i).slice(0, 3);
      out[k] = list.length ? list : ["gradient"];
    }
    return out;
  };
  const bibleText = bp ? `配色與字體遵守${req.bandName ? `${req.bandName}的` : "樂團"}視覺聖經。` : "";
  const moodCue = (what: string) => (mood ? `參考圖量到的主色${mood.vivid ? ` ${mood.vivid}` : ""}：${what}` : "");
  const specs: DirectionSpec[] = [];
  const title = req.meta?.title || "這首歌";
  // the three palettes stay apart: film takes the song's image of its temperature, the collage
  // the most vivid image of another colour, the minimal accent a third one
  let filmHue: number | null = null;
  let collageHue: number | null = null;

  // A: film
  {
    const refs = refsFor(req.moodboard, mood, "取了它的色溫與明暗當作底色與主色");
    const songHue = nativeAxis === "film" && genreColours ? genre!.palette.hues[0] : imageHue(f, (h) => h.family.temperature === (warm ? "warm" : "cool"));
    filmHue = songHue ?? (warm ? 28 : 208);
    const palette = bp ? rolesFirst(bp.entries, "shadow") : filmPalette(mood, warm, songHue);
    const name = bp ? "暗房膠片" : warm ? "暖調膠片感" : "冷調膠片感";
    const imgs = imageList(req.moodboard, refs);
    const typo = filmFont(f);
    specs.push({
      name,
      pitch: `像一卷${warm ? "偏暖" : "偏冷"}的底片：${names.length ? `把${names.join("與")}拍成` : "拍成"}低飽和的顆粒與光斑，讓歌詞安靜地浮在畫面上。`,
      rationale: [
        `${briefHint}從${imageryText}出發，把舞台當成一段${warm ? "泛黃" : "冷藍"}的膠片記憶；${f.audio.quadrant === "gentle-float" || f.audio.quadrant === "dark-slow" ? "歌曲的慢板與留白正適合這種節制的質地" : "用節制的畫面反襯歌曲的能量，副歌才顯得有力"}。`,
        findingsText,
        native("film"),
        imgs ? `${imgs}：${moodCue("取它的色溫與明暗當作底色與主色")}。` : "",
        bibleText,
      ].join(""),
      references: refs,
      moodKeywords: [...(warm ? ["懷舊", "顆粒", "溫度"] : ["冷調", "顆粒", "距離感"]), ...f.imagery.slice(0, 2).map((h) => h.family.name), "留白"].filter((k, i, a) => a.indexOf(k) === i).slice(0, 5),
      palette,
      typography: bible ? bibleFonts(bible, FILM.typography.letterSpacing, "沿用樂團視覺聖經的字體，字距放寬帶出電影字卡的呼吸感。") : withRationale(typo, typo.cjkFont === "noto-serif-tc" ? "宋體與高對比襯線字像電影片頭字卡，字重 700 在 LED 上仍清楚。" : "手寫與舊式的字，像底片邊上的字卡，字重 700 在 LED 上仍清楚。"),
      motifs: ["底片顆粒", ...(f.imagery[0] ? [f.imagery[0].family.motif] : ["雨絲光線"]), ...(nativeAxis === "film" && genre ? genre.motifs.slice(0, 1) : []), "柔焦光斑"].filter((m, i, a) => a.indexOf(m) === i).slice(0, 4),
      emblem: FILM.emblem,
      scenes: scenesOf(FILM, FILM_SCENES, true),
      sceneTendency: `星雲、雨絲、波形與光斑${names.length ? `，${names[0]}的畫面放在主歌` : ""}：柔和、慢速、低飽和，副歌只把粒子密度拉高，不換成激烈的幾何。`,
      lyrics: FILM.lyrics,
      lyricTreatment: `${voiceTreatment(filmVoice, phrase)}${genreLyrics("film")}`,
      typeVoice: filmVoice,
      treatments: bible?.treatments.length ? bible.treatments : FILM.treatments,
      energy: FILM.energy,
      motion: FILM.motion,
    });
  }
  // B: collage
  {
    const refs = refsFor(req.moodboard, mood, "取了它最飽和的顏色放大成撞色拼貼");
    const vivid = distinctImage(f, [filmHue], "vivid", warm ? "cool" : "warm");
    const genreHue = genre ? genre.palette.hues.find((h) => filmHue == null || hueDistance(h, filmHue) >= 40) ?? null : null;
    const songHue = nativeAxis === "collage" && genreColours && genreHue != null ? genreHue : vivid ? vivid.family.hues[0] : genreHue;
    collageHue = songHue ?? 12;
    const palette = bp ? rolesFirst(bp.entries, "accent") : collagePalette(mood, songHue);
    const imgs = imageList(req.moodboard, refs);
    specs.push({
      name: bp ? "高彩拼貼" : "飽和拼貼",
      pitch: `撞色、碎片與網格，像一張張貼上去的海報，副歌用巨字${phrase ? `喊出「${phrase}」` : "喊出來"}。`,
      rationale: [
        `把〈${title}〉做成一面會跳動的拼貼牆：飽和的撞色、碎片與網格隨節拍切換，副歌用巨字口號帶全場合唱。`,
        findingsText,
        native("collage"),
        imgs ? `${imgs}：${moodCue("放大成撞色拼貼的主色")}。` : "",
        bibleText,
      ].join(""),
      references: refs,
      moodKeywords: ["撞色", "拼貼", "能量", ...(vivid ? [vivid.family.name] : []), "口號"].filter((k, i, a) => a.indexOf(k) === i).slice(0, 5),
      palette,
      typography: bible ? bibleFonts(bible, COLLAGE.typography.letterSpacing, "沿用樂團視覺聖經的字體，用最粗的字重做海報式的口號。") : withRationale(COLLAGE.typography, "粗黑體與窄體大寫像街頭海報，遠距離也一眼讀到口號。"),
      motifs: [...(vivid ? [vivid.family.motif] : ["撕貼紙片"]), "網點印刷", ...(genre?.motifs.slice(0, 1) ?? ["放射線"])].filter((m, i, a) => a.indexOf(m) === i),
      emblem: vivid?.family.emblem === "shard" || !vivid ? COLLAGE.emblem : vivid.family.emblem,
      scenes: scenesOf(COLLAGE, COLLAGE_SCENES, false),
      sceneTendency: "碎片、網格、粒子到隧道：高飽和、快切、跟拍點反應，最後一次副歌衝進隧道。",
      lyrics: COLLAGE.lyrics,
      lyricTreatment: `${voiceTreatment(collageVoice, phrase)}${genreLyrics("collage")}`,
      typeVoice: collageVoice,
      treatments: bible?.treatments.length ? bible.treatments : COLLAGE.treatments,
      energy: COLLAGE.energy,
      motion: COLLAGE.motion,
    });
  }
  // C: minimal
  {
    const refs = mood ? refsFor(req.moodboard, mood, "只取它的一個顏色當唯一的點綴") : [];
    const accentImage = distinctImage(f, [filmHue, collageHue], "weight");
    const genreAccent = nativeAxis === "minimal" && genreColours ? genre!.palette.hues.find((h) => [filmHue, collageHue].every((t) => t == null || hueDistance(h, t) >= 40)) ?? null : null;
    const accentHue = genreAccent ?? (accentImage ? accentImage.family.hues[0] : null);
    const palette = bp ? rolesFirst(bp.entries, "primary").slice(0, 4) : minimalPalette(mood, accentHue);
    const imgs = imageList(req.moodboard, refs);
    specs.push({
      name: bp ? "留白極簡" : "黑白極簡",
      pitch: phrase ? `黑、白與一個點綴色：大量留白，讓「${phrase}」這幾個字與主唱成為唯一的焦點。` : "黑、白與一個點綴色：大量留白，讓字與主唱成為唯一的焦點。",
      rationale: [
        "把畫面減到只剩黑白、水墨與漸層，靠字體與留白說故事；螢幕像一張海報，把舞台燈光和主唱還給觀眾。",
        genreAccent != null
          ? `唯一的點綴色取自${genre!.label}的配色（${genre!.palette.note}）。`
          : accentImage && !mood && !bp
            ? `唯一的點綴色取自歌詞的「${accentImage.family.name}」（${accentImage.family.colors.split("、")[0]}）。`
            : "",
        findingsText,
        native("minimal"),
        imgs ? `${imgs}：${moodCue("唯一的點綴色")}。` : "",
        bibleText,
      ].join(""),
      references: refs,
      moodKeywords: ["極簡", "留白", "黑白", "文字"],
      palette,
      typography: bible ? bibleFonts(bible, MINIMAL.typography.letterSpacing, "沿用樂團視覺聖經的字體，字距拉開像海報排版。") : withRationale(MINIMAL.typography, "中性的黑體加寬字距，像海報排版，極簡畫面裡字就是主角。"),
      motifs: ["一條線", "黑白對比", phrase ? `「${phrase}」的字` : "留白"],
      emblem: MINIMAL.emblem,
      scenes: scenesOf(MINIMAL, MINIMAL_SCENES, false),
      sceneTendency: "漸層、水墨與主視覺符號：黑白為主、動得很少，breakdown 可以全黑。",
      lyrics: MINIMAL.lyrics,
      lyricTreatment: `${voiceTreatment(minimalVoice, phrase)}字就是畫面。${genreLyrics("minimal")}`,
      typeVoice: minimalVoice,
      treatments: bible?.treatments.length ? bible.treatments : MINIMAL.treatments,
      energy: MINIMAL.energy,
      motion: MINIMAL.motion,
    });
  }
  return specs;
}

function bibleFonts(bible: NonNullable<ReturnType<typeof activeBible>>, letterSpacing: number, why: string): KeyVisual["typography"] {
  return withRationale({ cjkFont: bible.fonts.cjkFont, latinFont: bible.fonts.latinFont, weight: bible.fonts.weight, letterSpacing }, why);
}

/** The bible palette reordered so a different role leads (background stays first). */
function rolesFirst(entries: readonly PaletteEntry[], lead: "shadow" | "accent" | "primary"): PaletteEntry[] {
  const list = [...entries];
  if (list.length < 3) return list;
  const [bg, ...rest] = list;
  const byLum = [...rest].sort((a, b) => luminance(a.hex) - luminance(b.hex));
  const byContrast = [...rest].sort((a, b) => contrastRatio(b.hex, bg.hex) - contrastRatio(a.hex, bg.hex));
  const ordered = lead === "shadow" ? byLum : lead === "accent" ? byContrast : rest;
  return [bg, ...ordered];
}

// ---------------------------------------------------------------------------
// expansion into a full plan
// ---------------------------------------------------------------------------

function sectionHasLines(req: DesignRequest, start: number, end: number): boolean {
  return (req.lyrics?.lines ?? []).some((l) => typeof l.start === "number" && l.start >= start - 0.01 && l.start < end && l.text.trim());
}

function softTransition(t: SectionDesign["transitionIn"], motion: Motion, kind: SectionKind): SectionDesign["transitionIn"] {
  if (motion === "punchy") return kind === "chorus" && t === "wipe" ? "cut" : t;
  if (t === "flash") return "bloom";
  if (t === "cut") return "fade";
  return t;
}

function colorwayOf(kind: SectionKind, ordinal: number, total: number, r: ReturnType<typeof paletteRoles>, motion: Motion): [string, string, string] {
  const lastChorus = kind === "chorus" && total > 1 && ordinal === total - 1;
  switch (kind) {
    case "chorus":
      return motion === "punchy" ? [lastChorus ? r.bg2 : r.bg, r.accent, r.highlight] : [r.bg, r.primary, r.highlight];
    case "bridge":
    case "breakdown":
      return [r.bg2, r.highlight, r.primary];
    case "solo":
      return [r.bg2, r.accent, r.primary];
    case "intro":
    case "outro":
    case "interlude":
      return [r.bg, r.primary, r.highlight];
    default:
      return [r.bg, r.primary, r.accent];
  }
}

function pickScene(list: readonly SceneId[], kind: SectionKind, ordinal: number, total: number, prev: SceneId | null): SceneId {
  if (!list.length) return "gradient";
  let idx: number;
  if (kind === "chorus") idx = total > 1 && ordinal === total - 1 ? list.length - 1 : Math.min(list.length - 1, ordinal);
  else idx = ordinal % list.length;
  let pick = list[idx];
  if (pick === prev && list.length > 1) pick = list[(idx + 1) % list.length];
  return pick;
}

function planNotes(spec: DirectionSpec, letter: string, sections: readonly SectionDesign[], typeSystem?: DesignPlan["typeSystem"]): string {
  const choruses = sections.filter((s) => s.kind === "chorus");
  const hidden = sections.filter((s) => s.lyricStyle === "hidden").map((s) => s.label);
  const recipes = typeSystem?.lines.length ? topRecipes(typeSystem).map((id) => `「${RECIPES[id].label}」`).join("、") : "";
  return [
    `## 方向 ${letter}：${spec.name}`,
    spec.pitch,
    "",
    "## 為什麼",
    spec.rationale,
    "",
    "## 場景與歌詞",
    `- 場景傾向：${spec.sceneTendency}`,
    `- 歌詞處理：${spec.lyricTreatment}`,
    ...(typeSystem && recipes ? [`- 字體語言：${VOICES[typeSystem.voice].label}，主要構圖${recipes}；每一句都是排好的構圖，不是字幕。`] : []),
    choruses.length
      ? `- 副歌：${choruses.map((c) => `${c.label}「${SCENES[c.scene].label}${typeSystem ? "" : `／${LYRIC_STYLES[c.lyricStyle].label}`}」`).join("、")}`
      : "- 沒有偵測到副歌，能量最高的段落是這個方向的高點。",
    hidden.length ? `- 不放歌詞：${hidden.join("、")}` : "- 每段都有歌詞，畫面要保持節制。",
    "",
    "## 現場注意",
    "- 任何狀況先按 **B** 全黑；樂團延長或跳段時切到現場模式手動 cue。",
  ].join("\n");
}

/**
 * The full plan of a direction for this song: the song's structure, media, emphasized lines and
 * cues from the offline designer, then the direction's palette, typography, scenes, lyric styles
 * and texture per section (the bible's avoided scenes and lyric policy still apply). Normalized.
 */
export function expandDirection(spec: DirectionSpec, req: DesignRequest, letter = "A"): DesignPlan {
  const base = offlineDesign(req);
  const bible = activeBible(req.bible);
  const cjk = analyzeStructure(req).cjk;
  const roles = paletteRoles(spec.palette.map((p) => p.hex));
  const hexes = spec.palette.map((p) => p.hex);
  const avoid = new Set(bible?.sceneAvoid ?? []);
  const counts = new Map<SectionKind, number>();
  for (const s of base.sections) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const seen = new Map<SectionKind, number>();
  let prev: SceneId | null = null;
  let loudest = -1;
  base.sections.forEach((s, i) => {
    if (sectionHasLines(req, s.start, s.end) && (loudest < 0 || s.energy > base.sections[loudest].energy)) loudest = i;
  });
  const chorusCount = counts.get("chorus") ?? 0;
  const gain = 0.7 + 0.6 * clamp(spec.energy, 0, 1);
  const r2 = (x: number) => Math.round(clamp(x, 0, 1) * 100) / 100;
  let treatTurn = 0;
  const sections = base.sections.map((s, i): SectionDesign => {
    const ordinal = seen.get(s.kind) ?? 0;
    seen.set(s.kind, ordinal + 1);
    const total = counts.get(s.kind) ?? 1;
    const family = (spec.scenes[s.kind] ?? spec.scenes.verse ?? ["gradient"]).filter((sc) => !avoid.has(sc));
    let scene = s.scene === "blackout" && !avoid.has("blackout") ? "blackout" : pickScene(family.length ? family : ["gradient"], s.kind, ordinal, total, prev);
    if (avoid.has(scene)) scene = "gradient";
    prev = scene;
    const hasLines = sectionHasLines(req, s.start, s.end);
    let lyric = hasLines ? (spec.lyrics[s.kind] ?? { style: s.lyricStyle, placement: s.lyricPlacement }) : { style: "hidden" as LyricStyleId, placement: s.lyricPlacement };
    // every sung line appears (字體藝術), never as karaoke / subtitle; Latin text is never vertical
    if (hasLines && lyric.style === "hidden") lyric = { style: "line-fade", placement: "upper-third" };
    if (lyric.style === "karaoke") lyric = { style: "word-pop", placement: lyric.placement };
    if (lyric.style === "subtitle") lyric = { style: "line-fade", placement: lyric.placement === "lower-third" ? "upper-third" : lyric.placement };
    if (lyric.style === "vertical" && !cjk) lyric = { style: "stack", placement: "left" };
    if (lyric.style !== "vertical" && (lyric.placement === "vertical-left" || lyric.placement === "vertical-right")) lyric = { ...lyric, placement: "center" };
    if (lyric.style === "vertical" && lyric.placement !== "vertical-left" && lyric.placement !== "vertical-right") lyric = { ...lyric, placement: "vertical-right" };
    const policed = applyLyricPolicy(
      { style: lyric.style, placement: lyric.placement, scale: s.lyricScale },
      { kind: s.kind, energy: s.energy, hasLines },
      { bible, isLastChorus: s.kind === "chorus" && ordinal === total - 1, isLoudest: i === loudest, hasChorus: chorusCount > 0 },
    );
    const colorway = colorwayOf(s.kind, ordinal, total, roles, spec.motion);
    const scale = policed.style === "impact" ? Math.max(policed.scale, 1.15) : policed.scale;
    let media = s.media;
    if (media && spec.treatments.length && !spec.treatments.includes(media.treatment) && media.blend !== "screen") {
      const options = spec.treatments.filter((t) => (t === "beat-cut" ? s.energy >= 0.55 : true) && !(t === "mask-lyrics" && policed.style === "hidden"));
      if (options.length) media = { ...media, treatment: options[treatTurn++ % options.length] };
    }
    const sceneLabel = SCENES[scene].label;
    const styleLabel = `${VOICES[spec.typeVoice].short}構圖`;
    return {
      ...s,
      scene,
      sceneParams: {
        speed: r2(s.sceneParams.speed * (spec.motion === "punchy" ? 1.15 : 0.8)),
        density: r2(s.sceneParams.density * (0.8 + 0.4 * spec.energy)),
        intensity: r2(scene === "blackout" ? 0.2 : s.sceneParams.intensity * gain),
        audioReactivity: r2(s.sceneParams.audioReactivity * (spec.motion === "punchy" ? 1.2 : 0.75)),
      },
      colorway,
      lyricStyle: policed.style,
      lyricPlacement: policed.placement,
      lyricScale: Math.round(scale * 100) / 100,
      lyricColor: ensureContrast(roles.lyric, colorway[0], hexes),
      transitionIn: softTransition(s.transitionIn, spec.motion, s.kind),
      media,
      rationale:
        policed.style === "hidden"
          ? `方向 ${letter}「${spec.name}」：${SECTION_KIND_LABELS[s.kind]}用「${sceneLabel}」，不放歌詞，讓畫面${spec.motion === "punchy" ? "跟著節拍衝" : "安靜地呼吸"}。`
          : `方向 ${letter}「${spec.name}」：${SECTION_KIND_LABELS[s.kind]}用「${sceneLabel}」，每一句歌詞都是「${styleLabel}」。`,
    };
  });
  // 字體藝術: the direction's voice, its fonts (the bible's when there is one) and a composition per line
  const lineDesigns = base.lines.map((l) => (l.styleOverride === "impact" && spec.motion === "soft" ? { ...l, styleOverride: null, note: l.note === "口號句：巨字帶動全場" ? "" : l.note } : l));
  const typeParams: Partial<TypeParams> = spec.motion === "soft" ? { motionSpeed: Math.min(VOICES[spec.typeVoice].params.motionSpeed, 0.4) } : { motionIntensity: Math.max(VOICES[spec.typeVoice].params.motionIntensity, 0.55) };
  const { system: typeSystem } = designTypeSystem({
    lines: (req.lyrics?.lines ?? []).filter((l) => l && typeof l.id === "string" && typeof l.text === "string"),
    sections,
    duration: base.sections.at(-1)?.end ?? 0,
    findings: analyzeFindings(req),
    cjk,
    bible,
    planFonts: { cjk: spec.typography.cjkFont, latin: spec.typography.latinFont },
    voice: spec.typeVoice,
    params: typeParams,
    lineDesigns,
    bandName: req.bandName,
    title: req.meta?.title,
  });
  const plan: DesignPlan = {
    version: 1,
    keyVisual: {
      title: spec.name,
      concept: `${spec.pitch}${spec.rationale ? ` ${spec.rationale}` : ""}`.slice(0, 900),
      moodKeywords: spec.moodKeywords.slice(0, 6),
      palette: spec.palette,
      motifs: spec.motifs.length >= 2 ? spec.motifs.slice(0, 5) : [...spec.motifs, "光的節奏", "留白"].slice(0, 3),
      motifSvg: generateMotifSvg(`${req.meta?.title ?? ""}|${req.meta?.artist ?? ""}|${letter}|${spec.name}`, spec.emblem),
      typography: spec.typography,
    },
    sections,
    // impact overrides only fit the looks that shout
    lines: lineDesigns,
    cues: base.cues,
    designerNotes: planNotes(spec, letter, sections, typeSystem.lines.length ? typeSystem : undefined),
    typeSystem,
  };
  // 專屬畫面: each direction its own world (forms from its scene families)
  plan.sceneProgram = directionSceneProgram(req, plan, [...(spec.scenes.chorus ?? []), ...(spec.scenes.verse ?? [])], letter);
  return normalizePlan(plan, req);
}

// ---------------------------------------------------------------------------
// Claude: one structured-output call for 2–3 specs
// ---------------------------------------------------------------------------

const hexField = z.string().describe("CSS hex color #rrggbb (lowercase)");

export const DirectionDraftSchema = z.object({
  directions: z
    .array(
      z.object({
        name: z.string().describe("方向名稱（繁體中文，4–8 字），例如「冷調膠片感」「飽和拼貼」「黑白極簡」"),
        pitch: z.string().describe("一句話的提案（繁體中文，40 字內），給樂團看的"),
        rationale: z.string().describe("情緒與參考理由（繁體中文，2–4 句）：引用研究簡報的具體發現，並用「圖 n」註明哪張參考圖啟發了什麼"),
        references: z
          .array(z.object({ image: z.number().describe("參考圖編號（圖 n 的 n，從 1 開始）"), cue: z.string().describe("從這張圖取了什麼（繁體中文，20 字內）") }))
          .describe("這個方向引用的參考圖；沒有參考圖時為空陣列"),
        moodKeywords: z.array(z.string()).describe("3–5 個情緒／質感關鍵字（繁體中文）"),
        palette: z
          .array(z.object({ hex: hexField, role: z.string().describe("背景、主色、點綴、歌詞、高光…"), name: z.string().describe("顏色的詩意名稱（繁體中文）") }))
          .describe("4–6 色，第一色是最深的背景色，並包含一個與背景對比 ≥ 4.5:1 的歌詞亮色"),
        typography: z.object({
          cjkFont: FontIdSchema.describe("CJK 中文字體 id"),
          latinFont: FontIdSchema.describe("拉丁字體 id"),
          weight: z.number().describe("600–900"),
          letterSpacing: z.number().describe("em，約 -0.02 到 0.2"),
          rationale: z.string().describe("為什麼選這組字體（繁體中文，1 句）"),
        }),
        motifs: z.array(z.string()).describe("2–4 個視覺母題（繁體中文短語）"),
        emblem: z.enum(EMBLEM_STYLES as unknown as [EmblemStyle, ...EmblemStyle[]]).describe("主視覺符號的造型：sun 放射、crystal 晶體、orbit 軌道、wave 波、bloom 花、shard 碎片"),
        scenes: z
          .array(z.object({ kind: SectionKindSchema, scenes: z.array(SceneIdSchema).describe("1–3 個場景，最典型的在前；副歌依序往後推進") }))
          .describe("每種段落的場景家族（至少涵蓋 intro、verse、chorus、bridge、outro）"),
        sceneTendency: z.string().describe("場景傾向（繁體中文，1–2 句）"),
        lyrics: z.array(z.object({ kind: SectionKindSchema, style: AutoLyricStyleIdSchema, placement: LyricPlacementSchema })).describe("每種段落的後備歌詞樣式與位置（舊版渲染器用；實際每一句都依字體語言構圖）"),
        typeVoice: TypeVoiceIdSchema.describe("字體語言：mv-card 日系 MV 字卡、title-sequence 電影片頭／動態海報、ink 書法與水墨、glitch 實驗／故障感；每個方向用不同的一個"),
        lyricTreatment: z.string().describe("歌詞怎麼排版（繁體中文，1–2 句）：這個字體語言怎麼把每一句排成構圖"),
        treatments: z.array(MediaTreatmentSchema).describe("樂團素材偏好的處理（0–3 個）"),
        energy: z.number().describe("0–1 這個方向整體的強度"),
        motion: z.enum(["soft", "punchy"]).describe("soft = 柔和的轉場與慢速；punchy = 快切、跟拍點"),
      }),
    )
    .describe("2 或 3 個彼此明顯不同的設計方向"),
});

export const DIRECTIONS_SYSTEM = `你是這個樂團的專職舞台視覺總監。專業的設計師不會只交一個方案：在製作之前，你會先向樂團提出 2 到 3 個彼此明顯不同的「設計方向」（例如 A 冷調膠片感、B 飽和拼貼、C 黑白極簡），每個方向都有名字、一句話提案、理由與關鍵的視覺決定，讓樂團選一個或給意見，之後才進入製作。

# 方向要真的不同
- 至少在這些軸上拉開：色溫與飽和度（冷／暖、低彩／高彩／黑白）、材質（顆粒、網點、筆觸、乾淨）、場景家族（柔和的星雲雨絲 vs. 碎片網格隧道 vs. 漸層水墨）、字體語言（typeVoice，每個方向不同）、節奏（柔和 vs. 快切）。
- 歌詞是視覺藝術：每一句歌詞都會排成一張設計過的構圖（字體藝術），不是卡拉 OK 或字幕。四種字體語言——mv-card 日系 MV 字卡（極端字級對比、直橫混排、大留白、拍點硬切、「」當圖形）、title-sequence 電影片頭／動態海報（字就是形狀、出血、瑞士網格、細線與編號、遮罩擦出）、ink 書法與水墨（楷書依筆順寫出、直排、暈染飛白、紅色印章）、glitch 實驗／故障感（切片錯位、RGB 分離、殘影、疊印與顆粒）——三個方向各選一個不同的。
- 三個方向都必須成立：適合這首歌、這個樂團，都能在 LED 大螢幕上讀得清楚；不要做一個明顯是湊數的方向。
- 視覺是配角、托起樂團：唱到的每一句都會出現，但主歌小而安靜、副歌才大；歌詞色與背景對比至少 4.5:1；字重 600 以上。

# 理由要有根據
- 引用研究簡報裡的具體發現（專輯封面、MV、招牌色、現場習慣），不要空泛的形容詞。
- 有參考圖時真的看圖：萃取配色、材質、構圖與字體線索，並在 rationale 用「圖 n」註明、在 references 列出。操作員寫在圖上的說明最重要。
- 有樂團視覺聖經時，它是硬性規範：配色取自聖經色盤（可調整明暗、換角色，不換色相）、字體用聖經字體、避免的場景不用、遵守歌詞政策。三個方向在這個世界裡找不同的切入點。

${catalogBlock()}

# 輸出規則
- 所有給人看的文字都用繁體中文；不要重製歌詞，提到歌詞只用幾個字。
- palette 4–6 色、小寫 #rrggbb，第一色是最深的背景色。
- scenes 與 lyrics 用段落種類（kind）描述傾向，不需要逐段的時間；實際的段落由系統依歌曲結構展開。
- 回覆中不要包含任何內部或系統用的 XML 標籤。`;

export function buildDirectionsPrompt(req: DesignRequest): string {
  const st = analyzeStructure(req);
  const parts = [
    "# 歌曲",
    songBlock(req, st.duration),
    "",
    "# 音訊分析",
    analysisSummary(req, st),
    "",
    "# 歌詞摘要（不要重製歌詞）",
    lyricExcerpt(req, st),
    "",
    "# 研究簡報",
    trimBrief(req.research).slice(0, 7000),
  ];
  const bible = bibleBlock(req.bible, req.bandName);
  if (bible) parts.push("", "# 樂團視覺聖經（硬性規範）", bible);
  const mood = moodboardBlock(req.moodboard, req.moodboardImages);
  if (mood) parts.push("", "# 參考圖（mood board）", mood);
  const assets = (req.assets ?? []).length;
  if (assets) parts.push("", `# 樂團素材\n- 有 ${assets} 個素材（專輯封面、照片、MV、logo）；方向可以用 treatments 說明怎麼處理它們。`);
  if (req.previous) parts.push("", `# 目前的方案\n- 主視覺「${req.previous.keyVisual.title}」，${req.previous.sections.length} 段。新的方向可以有一個延續它，其他要拉開距離。`);
  const instruction = req.instruction?.trim();
  if (instruction) parts.push("", `# 操作員對這次提案的要求\n「${instruction.slice(0, 600)}」`);
  parts.push("", `請提出 ${MAX_DIRECTIONS} 個（至少 ${MIN_DIRECTIONS} 個）設計方向。`);
  return parts.join("\n");
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

function draftPalette(raw: unknown, bible: ReturnType<typeof activeBible>, fallback: PaletteEntry[]): PaletteEntry[] {
  const list: PaletteEntry[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!isObj(c)) continue;
    const hex = normalizeHex(c.hex);
    if (!hex || list.some((x) => x.hex === hex)) continue;
    list.push({ hex, role: text(c.role, 20) || "色彩", name: text(c.name, 20) || colorName(hex) });
  }
  if (list.length < 3) return fallback;
  // the background first
  const darkest = list.reduce((d, c) => (luminance(c.hex) < luminance(d.hex) ? c : d), list[0]);
  const ordered = [darkest, ...list.filter((c) => c !== darkest)].slice(0, 6);
  if (!ordered.some((c) => contrastRatio(c.hex, ordered[0].hex) >= 4.5)) ordered.push({ hex: ensureContrast(null, ordered[0].hex, []), role: "歌詞", name: "月白" });
  // the bible palette is a hard constraint: hues must come from it
  const bp = biblePalette(bible);
  if (bp) {
    const bibleHues = bp.entries.map((e) => hexToHsl(e.hex));
    const inWorld = ordered.every((c) => {
      const h = hexToHsl(c.hex);
      return h.s < 0.12 || bibleHues.some((b) => b.s < 0.12 || hueDistance(b.h, h.h) <= 18);
    });
    if (!inWorld) return fallback;
  }
  return ordered.slice(0, 6);
}

function draftTypography(raw: unknown, bible: ReturnType<typeof activeBible>, fallback: KeyVisual["typography"]): KeyVisual["typography"] {
  const o = isObj(raw) ? raw : {};
  const cjk = typeof o.cjkFont === "string" && FONT_CATALOG[o.cjkFont as keyof typeof FONT_CATALOG]?.cjk ? (o.cjkFont as KeyVisual["typography"]["cjkFont"]) : fallback.cjkFont;
  const latin = typeof o.latinFont === "string" && FONT_CATALOG[o.latinFont as keyof typeof FONT_CATALOG] && !FONT_CATALOG[o.latinFont as keyof typeof FONT_CATALOG].cjk ? (o.latinFont as KeyVisual["typography"]["latinFont"]) : fallback.latinFont;
  const weight = typeof o.weight === "number" && Number.isFinite(o.weight) ? Math.round(clamp(o.weight, 600, 900) / 100) * 100 : fallback.weight;
  const letterSpacing = typeof o.letterSpacing === "number" && Number.isFinite(o.letterSpacing) ? Math.round(clamp(o.letterSpacing, -0.02, 0.2) * 1000) / 1000 : fallback.letterSpacing;
  const rationale = text(o.rationale, 200) || fallback.rationale;
  if (bible) return { cjkFont: bible.fonts.cjkFont, latinFont: bible.fonts.latinFont, weight: bible.fonts.weight, letterSpacing, rationale: `${rationale}（字體依樂團視覺聖經）` };
  return { cjkFont: cjk, latinFont: latin, weight, letterSpacing, rationale };
}

/**
 * Claude's directions as specs: every field checked against the closed vocabularies, palettes and
 * fonts repaired (the bible's win), image numbers mapped to mood board ids. Unusable or duplicate
 * directions are replaced by offline ones, so the result always has 2–3 distinct specs.
 */
export function normalizeDirectionDrafts(raw: unknown, req: DesignRequest, offline: readonly DirectionSpec[]): DirectionSpec[] {
  const bible = activeBible(req.bible);
  const avoid = new Set(bible?.sceneAvoid ?? []);
  const board = req.moodboard ?? [];
  const drafts = isObj(raw) && Array.isArray(raw.directions) ? raw.directions.filter(isObj).slice(0, MAX_DIRECTIONS) : [];
  const out: DirectionSpec[] = [];
  drafts.forEach((d, i) => {
    const fb = offline[i % offline.length];
    const name = text(d.name, 16);
    if (!name) return;
    const scenes: Partial<Record<SectionKind, SceneId[]>> = {};
    for (const row of Array.isArray(d.scenes) ? d.scenes : []) {
      if (!isObj(row) || !(SECTION_KINDS as readonly string[]).includes(row.kind as string)) continue;
      const list = (Array.isArray(row.scenes) ? row.scenes : []).filter((s): s is SceneId => (SCENE_IDS as readonly string[]).includes(s as string) && !avoid.has(s as SceneId)).slice(0, 3);
      if (list.length) scenes[row.kind as SectionKind] = [...new Set(list)];
    }
    for (const k of KINDS) if (!scenes[k]) scenes[k] = fb.scenes[k] ?? ["gradient"];
    const lyrics: DirectionSpec["lyrics"] = { ...fb.lyrics };
    for (const row of Array.isArray(d.lyrics) ? d.lyrics : []) {
      if (!isObj(row) || !(SECTION_KINDS as readonly string[]).includes(row.kind as string)) continue;
      // karaoke and subtitle are never chosen automatically (字體藝術): the fallback keeps its style
      if (!(AUTO_LYRIC_STYLE_IDS as readonly string[]).includes(row.style as string) || !(LYRIC_PLACEMENTS as readonly string[]).includes(row.placement as string)) continue;
      lyrics[row.kind as SectionKind] = { style: row.style as LyricStyleId, placement: row.placement as LyricPlacement };
    }
    const references: DirectionReference[] = [];
    for (const r of Array.isArray(d.references) ? d.references : []) {
      if (!isObj(r) || typeof r.image !== "number") continue;
      const img = board[Math.round(r.image) - 1];
      if (img && !references.some((x) => x.imageId === img.id)) references.push({ imageId: img.id, cue: text(r.cue, 60) });
    }
    const emblem = (EMBLEM_STYLES as readonly string[]).includes(d.emblem as string) ? (d.emblem as EmblemStyle) : fb.emblem;
    const treatments = (Array.isArray(d.treatments) ? d.treatments : []).filter((t): t is MediaTreatment => (MEDIA_TREATMENTS as readonly string[]).includes(t as string)).slice(0, 3);
    out.push({
      name,
      pitch: text(d.pitch, 120) || fb.pitch,
      rationale: text(d.rationale, 900) || fb.rationale,
      references,
      moodKeywords: (Array.isArray(d.moodKeywords) ? d.moodKeywords : []).map((k) => text(k, 12)).filter(Boolean).slice(0, 5),
      palette: draftPalette(d.palette, bible, fb.palette),
      typography: draftTypography(d.typography, bible, fb.typography),
      motifs: (Array.isArray(d.motifs) ? d.motifs : []).map((m) => text(m, 24)).filter(Boolean).slice(0, 4),
      emblem,
      scenes,
      sceneTendency: text(d.sceneTendency, 200) || fb.sceneTendency,
      lyrics,
      lyricTreatment: text(d.lyricTreatment, 200) || fb.lyricTreatment,
      typeVoice: (TYPE_VOICE_IDS as readonly string[]).includes(d.typeVoice as string) ? (d.typeVoice as TypeVoiceId) : fb.typeVoice,
      treatments: bible?.treatments.length ? bible.treatments : treatments.length ? treatments : fb.treatments,
      energy: typeof d.energy === "number" && Number.isFinite(d.energy) ? clamp(d.energy, 0, 1) : fb.energy,
      motion: d.motion === "punchy" ? "punchy" : d.motion === "soft" ? "soft" : fb.motion,
    });
  });
  // drop repeats (same name or the same palette), then top up with offline directions
  const distinct: DirectionSpec[] = [];
  for (const s of out) {
    const key = s.palette.map((p) => p.hex).join();
    if (distinct.some((d) => d.name === s.name || d.palette.map((p) => p.hex).join() === key)) continue;
    distinct.push(s);
  }
  for (const s of offline) {
    if (distinct.length >= MIN_DIRECTIONS) break;
    if (!distinct.some((d) => d.name === s.name)) distinct.push(s);
  }
  return distinct.slice(0, MAX_DIRECTIONS);
}

/**
 * Every direction speaks its own typographic voice: a repeated one (two Claude directions on the
 * same voice, or a Claude one meeting an offline top-up) moves to the next free voice, with the
 * lyric treatment rewritten for it. No brush calligraphy for Latin lyrics.
 */
export function distinctVoices(specs: readonly DirectionSpec[], cjk: boolean): DirectionSpec[] {
  const order: TypeVoiceId[] = (["mv-card", "title-sequence", "ink", "glitch"] as TypeVoiceId[]).filter((v) => cjk || v !== "ink");
  const used = new Set<TypeVoiceId>();
  return specs.map((spec) => {
    let voice: TypeVoiceId = !cjk && spec.typeVoice === "ink" ? "mv-card" : spec.typeVoice;
    if (used.has(voice)) voice = order.find((v) => !used.has(v)) ?? voice;
    used.add(voice);
    return voice === spec.typeVoice ? spec : { ...spec, typeVoice: voice, lyricTreatment: voiceTreatment(voice, null) };
  });
}

// ---------------------------------------------------------------------------
// specs -> stored directions
// ---------------------------------------------------------------------------

export function directionId(seed: string): string {
  return `d${hashString(seed).toString(16).padStart(8, "0").slice(-8)}`;
}

/** Stored directions from specs (letters A, B, C; ids unique within the set). */
export function buildDirections(specs: readonly DirectionSpec[], req: DesignRequest, meta: { engine: DirectionEngine; model?: string; now: string }): DesignDirection[] {
  const used = new Set<string>();
  return distinctVoices(specs.slice(0, MAX_DIRECTIONS), analyzeStructure(req).cjk).map((spec, i) => {
    const letter = DIRECTION_LETTERS[i];
    let id = directionId(`${meta.now}|${letter}|${spec.name}`);
    for (let k = 1; used.has(id); k++) id = directionId(`${meta.now}|${letter}|${spec.name}|${k}`);
    used.add(id);
    const d: DesignDirection = {
      id,
      letter,
      name: spec.name,
      pitch: spec.pitch,
      rationale: spec.rationale,
      references: spec.references,
      sceneTendency: spec.sceneTendency,
      lyricTreatment: spec.lyricTreatment,
      plan: expandDirection(spec, req, letter),
      status: "proposed",
      comments: [],
      engine: meta.engine,
      createdAt: meta.now,
      updatedAt: meta.now,
    };
    if (meta.model) d.model = meta.model;
    return d;
  });
}

/** Markdown summary streamed while (or after) the directions are made. */
export function directionsSummary(directions: readonly DesignDirection[]): string {
  return directions
    .map((d) => {
      const chorus = d.plan.sections.find((s) => s.kind === "chorus");
      const voice = d.plan.typeSystem ? VOICES[d.plan.typeSystem.voice]?.label : null;
      return `### 方向 ${d.letter}「${d.name}」\n${d.pitch}${voice ? `\n- 字體語言：${voice}` : ""}${chorus ? `\n- ${formatTimeShort(chorus.start)} 副歌：${SCENES[chorus.scene].label}${voice ? "" : `／${LYRIC_STYLES[chorus.lyricStyle].label}`}` : ""}`;
    })
    .join("\n\n");
}
