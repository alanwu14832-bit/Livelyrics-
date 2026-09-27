// The offline designer: a deterministic heuristic stage-visual designer used when no
// Anthropic credential is configured or Claude fails. It reads the audio analysis
// (energy, tempo, brightness), the lyric structure (repetition = chorus) and a small
// imagery lexicon, and produces a tasteful, valid DesignPlan plus a research brief
// that is honest about being a heuristic.

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
import { suggestCues } from "./cues";
import { findImagery, type ImageryHit } from "./imagery";
import { normalizePlan } from "./normalize";
import { buildPalette, SCHEMES, type PaletteEntry, type Scheme } from "./palette";
import { analyzeStructure, clamp, meanEnvelope, readingUnits, type SongStructure, type StructSection } from "./structure";
import { generateMotifSvg, hashString, type EmblemStyle } from "./svg";
import type { DesignerInput } from "./types";

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

function makePalette(seed: number, mood: Mood, imagery: ImageryHit[], hueOverride?: number, mono = false): Palette {
  const top = imagery[0]?.imagery;
  const jitter = ((seed >>> 8) % 21) - 10;
  const hue = hueOverride ?? (top ? top.hue + jitter : seed % 360);
  const scheme = MOOD_SCHEMES[mood.mood][(seed >>> 4) % 2] ?? SCHEMES[0];
  const saturation = mono ? 0 : MOOD_SATURATION[mood.mood] * (top?.saturation ?? 1);
  const entries = buildPalette({ hue, scheme, saturation, brightness: mood.brightness });
  const at = (i: number) => entries[Math.min(i, entries.length - 1)].hex;
  return { entries, bg: at(0), primary: at(1), accent: at(2), lyric: at(3), highlight: at(4), bg2: at(5) };
}

function makeTypography(mood: Mood, seed: number, imagery: ImageryHit[]): DesignPlan["keyVisual"]["typography"] {
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

const MOOD_TITLES: Record<MoodClass, string[]> = {
  calm: ["靜默的潮汐", "留白的光", "安靜的回聲"],
  warm: ["溫熱的光", "慢慢亮起的夜", "微光裡的我們"],
  driving: ["脈動的城市", "向前的光", "節拍裡的風"],
  explosive: ["失速的光", "燃燒的節拍", "全場的心跳"],
};
const MOOD_KEYWORDS: Record<MoodClass, string[]> = {
  calm: ["靜謐", "溫柔", "留白"],
  warm: ["溫暖", "懷舊", "光暈"],
  driving: ["脈動", "前進", "律動"],
  explosive: ["爆發", "熱血", "衝刺"],
};
const MOOD_MOTIF: Record<MoodClass, string> = { calm: "呼吸般的光環", warm: "溫暖的光暈", driving: "律動的幾何線條", explosive: "放射狀的光芒" };
const MOOD_EMBLEM: Record<MoodClass, EmblemStyle> = { calm: "orbit", warm: "bloom", driving: "wave", explosive: "sun" };

function makeTitle(mood: Mood, imagery: ImageryHit[], seed: number): string {
  const [a, b] = imagery.map((h) => h.imagery.name);
  if (a && b) {
    const templates = [`${a}裡的${b}`, `${a}與${b}`, `穿過${a}的${b}`, `${b}落在${a}`];
    const t = templates[seed % templates.length];
    if (t.length <= 12) return t;
  }
  if (a) {
    const templates = [`${a}的回聲`, `${a}之間`, `${a}進行式`, `點亮${a}`];
    return templates[seed % templates.length];
  }
  const list = MOOD_TITLES[mood.mood];
  return list[seed % list.length];
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
}

function chooseScene(s: StructSection, i: number, prev: SceneId | null, ordinal: number, ctx: SectionPlanCtx): SceneId {
  return avoidScene(chooseSceneRaw(s, i, prev, ordinal, ctx), ctx.bible, prev, biasScenes(SCENE_CANDIDATES[s.kind], ctx.bible));
}

function chooseSceneRaw(s: StructSection, i: number, prev: SceneId | null, ordinal: number, ctx: SectionPlanCtx): SceneId {
  const e = s.energy;
  const cands = (k: SectionKind) => biasScenes(SCENE_CANDIDATES[k], ctx.bible);
  if (s.kind === "chorus") {
    // choruses escalate: particles -> grid / shards -> tunnel on the last one (avoided scenes left out)
    const avoided = new Set(ctx.bible?.sceneAvoid ?? []);
    const kept = SCENE_CANDIDATES.chorus.filter((sc) => !avoided.has(sc));
    const ladder = kept.length ? kept : cands("chorus");
    const base = ctx.mood.mood === "explosive" ? 1 : ctx.mood.mood === "calm" ? 0 : (ctx.seed >>> 3) % 2;
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
  const lexScene = ctx.imagery.map((h) => h.imagery.scene).find((sc) => kindList.includes(sc) && fits(sc, e) && sc !== prev);
  if (lexScene && (s.kind === "verse" || s.kind === "bridge" || s.kind === "breakdown")) return lexScene;
  const pool = kindList.filter((sc) => fits(sc, e) && sc !== prev);
  const list = pool.length ? pool : kindList.filter((sc) => sc !== prev);
  if (s.kind === "intro" || s.kind === "outro") return list.includes("motif") ? "motif" : list[0];
  return list[(ctx.seed + i * 7 + ordinal) % list.length] ?? "nebula";
}

function sectionLines(st: SongStructure, s: StructSection) {
  const ids = new Set(s.lineIds);
  return st.lines.filter((l) => ids.has(l.id));
}

function chooseLyrics(
  s: StructSection,
  ordinal: number,
  ctx: SectionPlanCtx,
): { style: LyricStyleId; placement: LyricPlacement; scale: number } {
  const lines = sectionLines(ctx.st, s);
  if (!lines.length) return { style: "hidden", placement: "center", scale: 1 };
  const avgUnits = lines.reduce((a, l) => a + readingUnits(l.text), 0) / lines.length;
  const dense = s.density > 5;
  const poetic = ctx.cjk && avgUnits <= 10 && s.density < 3;
  switch (s.kind) {
    case "chorus": {
      if (dense) return { style: "karaoke", placement: "center", scale: 1.05 };
      const last = ordinal === ctx.chorusCount - 1 && ctx.chorusCount > 1;
      if (last) return avgUnits <= 9 ? { style: "impact", placement: "center", scale: 1.2 } : { style: "karaoke", placement: "center", scale: 1.2 };
      if (ordinal === 0) return { style: "karaoke", placement: "center", scale: 1.1 };
      return { style: "word-pop", placement: "center", scale: 1.15 };
    }
    case "verse":
      if (dense) return { style: "subtitle", placement: "lower-third", scale: 0.9 };
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

function transitionFor(s: StructSection, prev: StructSection | undefined): SectionDesign["transitionIn"] {
  if (!prev) return "fade";
  const rise = s.energy - prev.energy;
  if (s.kind === "chorus") return rise >= 0.25 ? "flash" : "wipe";
  if (s.kind === "solo") return rise >= 0.2 ? "cut" : "wipe";
  if (rise <= -0.2 || s.kind === "outro" || s.kind === "breakdown") return "fade";
  if (prev.kind === "intro" || s.kind === "bridge") return "bloom";
  return rise >= 0.15 ? "wipe" : "fade";
}

function rationaleFor(kind: SectionKind, scene: SceneId, style: LyricStyleId, placement: LyricPlacement, energy: number, songHasLyrics: boolean): string {
  const sc = SCENES[scene].label;
  const ly = LYRIC_STYLES[style].label;
  const where = LYRIC_PLACEMENTS_INFO[placement].split("：")[0];
  const hidden = style === "hidden";
  // how this section treats lyrics, for sections whose sentence depends on it
  const lyricClause = !songHasLyrics ? "這首歌沒有歌詞，畫面本身就是主角" : hidden ? "這段不放歌詞" : `歌詞以「${ly}」放在${where}`;
  switch (kind) {
    case "intro":
      return `以「${sc}」開場，先讓觀眾認得這首歌的世界；歌詞留白。`;
    case "chorus":
      return hidden
        ? `副歌能量 ${energy.toFixed(2)}，「${sc}」隨大鼓脈動；${lyricClause}，讓光與節拍帶動全場。`
        : `副歌能量 ${energy.toFixed(2)}，「${sc}」隨大鼓脈動；${lyricClause}，邀請全場合唱。`;
    case "verse":
      if (hidden) return `主歌以「${sc}」維持中低亮度；${lyricClause}，把焦點留給主唱。`;
      return style === "subtitle"
        ? `主歌字很密，畫面「${sc}」為主、歌詞退到小字幕，不和主唱搶戲。`
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
      return `回到「${sc}」收尾，與開場呼應；${hidden ? "歌詞留白" : "最後一句放大淡出"}。`;
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
      transitionIn: transitionFor(s, st.sections[i - 1]),
      media: null,
      rationale: rationaleFor(s.kind, scene, style, placement, e, ctx.st.lines.length > 0),
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
    const chant = CHANT.exec(l.text)?.[0];
    if (chant) emphasis.push(chant);
    for (const w of words) {
      if (emphasis.length >= 2) break;
      if (l.text.includes(w) && !emphasis.some((e) => e.includes(w) || w.includes(e))) emphasis.push(w);
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

function designerNotes(ctx: SectionPlanCtx, sections: SectionDesign[], title: string): string {
  const choruses = sections.filter((s) => s.kind === "chorus");
  const hidden = sections.filter((s) => s.lyricStyle === "hidden").map((s) => s.label);
  const verse = sections.find((s) => s.kind === "verse");
  const lines = [
    "## 敘事弧線",
    `以主視覺「${title}」開場建立世界觀，${arcDescription(ctx.st)}。畫面隨能量起伏，副歌一次比一次更亮、更快，最後回到主視覺收尾。`,
    "",
    "## 歌詞與動畫",
    ...(ctx.st.lines.length === 0
      ? [
          "- 這首歌目前沒有歌詞：全程由畫面與燈光敘事，安靜段落退後、能量高的段落跟著節拍爆開。",
          "- 之後在歌詞編輯器加入歌詞，再重新設計，就會得到每一段的歌詞呈現方式。",
        ]
      : [
          verse && verse.lyricStyle !== "hidden"
            ? `- 主歌：歌詞「${LYRIC_STYLES[verse.lyricStyle].label}」、畫面「${SCENES[verse.scene].label}」保持低調，把焦點留給主唱。`
            : "- 敘事段落：畫面保持低調，把焦點留給主唱。",
          choruses.length
            ? `- 副歌（${choruses.length} 次）：${choruses.map((c) => `${c.label}「${LYRIC_STYLES[c.lyricStyle].label}」`).join("、")}，重複的句子讓觀眾跟唱。`
            : "- 沒有偵測到重複的副歌，能量最高的段落以大字呈現。",
          hidden.length ? `- ${hidden.join("、")}不放歌詞，讓畫面與燈光當主角。` : "- 每段都有歌詞，注意畫面不要過度繁忙。",
        ]),
    "",
    "## 現場注意",
    "- 任何狀況先按 **B** 全黑；樂團即興延長或跳段時，切到現場模式手動 cue。",
    "- 歌詞放在上方或側邊，避開主唱 IMAG 與觀眾頭部遮擋的下緣。",
    "",
    "> 這份方案由**離線設計師**依音訊能量、歌詞重複段落與意象關鍵字自動產生，沒有經過網路研究。設定 `ANTHROPIC_API_KEY` 後重新設計，即可取得 Claude 研究樂團視覺後的完整方案。",
  ];
  return lines.join("\n");
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
}

export function offlineContext(input: DesignerInput): OfflineContext {
  const structure = analyzeStructure(input);
  const mood = analyzeMood(input, structure);
  const imagery = findImagery(
    structure.lines.map((l) => l.text),
    input.meta?.title ?? "",
  ).slice(0, 4);
  const seed = hashString(`${input.meta?.title ?? ""}|${input.meta?.artist ?? ""}`);
  return { structure, mood, imagery, seed };
}

/** Deterministic heuristic DesignPlan (already normalized). */
export function offlineDesign(input: DesignerInput, options: OfflineOptions = {}): DesignPlan {
  const { structure: st, mood, imagery, seed } = offlineContext(input);
  const bible = activeBible(input.bible);
  // the band's palette unless the operator asked for another hue / monochrome (a stated deviation)
  const fromBible = options.hue == null && !options.mono ? biblePalette(bible) : null;
  const palette: Palette = fromBible ?? makePalette(seed, mood, imagery, options.hue, options.mono);
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
  };
  const sections = applyTreatments(assignMedia(buildSections(ctx), input.assets), bible, input.assets);
  const title = makeTitle(mood, imagery, seed);
  const ownMotifs = [...imagery.slice(0, 3).map((h) => h.imagery.motif), MOOD_MOTIF[mood.mood]];
  const motifs = [...(bible?.motifs ?? []).slice(0, 3), ...ownMotifs].filter((m, i, a) => a.indexOf(m) === i).slice(0, bible?.motifs.length ? 5 : 4);
  const moodKeywords = [...MOOD_KEYWORDS[mood.mood], ...imagery.map((h) => h.imagery.name)].filter((k, i, a) => a.indexOf(k) === i).slice(0, 6);
  const emblem = imagery[0]?.imagery.emblem ?? MOOD_EMBLEM[mood.mood];
  const tempoText = mood.bpm ? `約 ${mood.bpm} BPM 的${MOOD_LABEL[mood.mood]}` : MOOD_LABEL[mood.mood];
  const imageryText = imagery.length ? `歌詞裡的${imagery.map((h) => `「${h.imagery.name}」`).join("")}` : "音樂本身的能量起伏";
  const concept = [
    `這首${tempoText}的歌，在舞台上是一個「${title}」的世界。`,
    `畫面從${imageryText}長出來，以${palette.entries[1].name}與${palette.entries[2].name}為主色，在${palette.entries[0].name}的深色背景上發光。`,
    st.lines.length > 0
      ? "主歌讓畫面退後、把空間留給主唱；副歌讓光與節拍一起爆開，邀請全場合唱。"
      : "這首歌不放歌詞：安靜的段落讓畫面退後，能量高的段落讓光與節拍一起爆開。",
    "視覺始終是配角：它是樂團背後的一道牆，托起表演而不搶戲。",
    bible ? `整首歌延續${input.bandName ? `${input.bandName}的` : "樂團"}視覺聖經：同一套色盤、字體與母題，讓它和其他歌活在同一個世界。` : "",
  ].join("");
  const baseTypography = makeTypography(mood, seed, imagery);
  const typography = bible
    ? {
        ...baseTypography,
        cjkFont: bible.fonts.cjkFont,
        latinFont: bible.fonts.latinFont,
        weight: bible.fonts.weight,
        rationale: `${FONT_CATALOG[bible.fonts.cjkFont].label}＋${FONT_CATALOG[bible.fonts.latinFont].label}：沿用樂團視覺聖經的字體，整場演出的歌詞是同一種聲音。`,
      }
    : baseTypography;

  const cues: CueNote[] = suggestCues(sections, st.duration, input.lyrics?.lines ?? []);
  const plan: DesignPlan = {
    version: 1,
    keyVisual: {
      title,
      concept,
      moodKeywords,
      palette: palette.entries,
      motifs: motifs.length >= 2 ? motifs : [...motifs, "光的節奏"],
      motifSvg: generateMotifSvg(`${input.meta?.title ?? ""}|${input.meta?.artist ?? ""}`, emblem),
      typography,
    },
    sections,
    lines: buildLines(ctx, sections),
    cues,
    designerNotes: designerNotes(ctx, sections, title),
  };
  return normalizePlan(plan, input);
}

/** Heuristic research brief with the same headings as Claude's, honest about its limits. */
export function offlineResearch(input: DesignerInput, reason?: string): Research {
  const { structure: st, mood, imagery } = offlineContext(input);
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
    `> **離線模式**：${reason ?? "尚未設定 Claude（ANTHROPIC_API_KEY）"}，以下是依音訊分析與歌詞自動推論的啟發式簡報，**沒有經過網路研究**，請把它當成起點而不是結論。`,
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
    `- 先訂下世界觀：以${imagery[0] ? `「${imagery[0].imagery.motif}」` : "一個簡單的幾何符號"}當主視覺，開場與結尾都回到它。`,
    "- 主歌讓歌詞退居幕後（小字幕或上方淡入），副歌才讓歌詞成為畫面主角。",
    "- 歌詞字重 700 以上、對比 4.5:1 以上、每次最多兩行，避開主唱 IMAG 與畫面下緣。",
    "",
    "## 參考來源",
    "- 無（離線模式不做網路搜尋）。",
    "- 啟用 Claude：在專案根目錄的 `.env.local` 加上 `ANTHROPIC_API_KEY=你的金鑰`，重新啟動伺服器後重新執行「研究」與「設計」。",
  ].join("\n");

  return { brief, sources: [], engine: "offline", createdAt: new Date().toISOString() };
}
