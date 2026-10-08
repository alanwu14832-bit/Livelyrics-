// 字體藝術 for the designers: the song's typographic voice from the free-research findings (the
// genre's grammar, else the audio mood and the lyric emotion), the per-line emphasis and motion words
// from the lyric analysis (chants, sing-along phrases, imagery), and the rule-based type system the
// offline designer, the offline directions and normalizePlan's fill use. Every line is set — a band
// bible's lyric policy and a sparse genre only make the verses smaller and quieter. Deterministic;
// no network.

import { normalizeTypeSystem } from "@/lib/type/normalize";
import { findMotionWord } from "@/lib/type/motion-words";
import { textKey } from "@/lib/type/sequence";
import { RECIPES, VOICES, voiceFonts } from "@/lib/type/vocab";
import type { BandBible, FontId, LineDesign, LyricLine, SectionDesign, TypeParams, TypeRecipeId, TypeSystem, TypeVoiceId } from "@/lib/types";
import type { Findings } from "./findings";
import { sensitiveWords } from "./lyric-analysis";

export interface VoiceChoice {
  voice: TypeVoiceId;
  /** parameters the song leans on (on top of the voice's defaults) */
  params: Partial<TypeParams>;
  /** why (繁中, one sentence) */
  why: string;
}

const LYRICAL = new Set(["憂傷低迴", "平靜內斂", "溫柔明亮"]);

/**
 * The song's voice. A known genre decides (punk / math rock → 故障, folk → 水墨, city pop → 片頭,
 * post-rock / shoegaze → 大留白的 MV 字卡…); without one the audio mood and the lyric emotion do:
 * a quiet song that explodes gets the MV card's extreme contrast, a dark slow ballad the brush, a
 * warm groove the film title, a hard cold drive the glitch.
 */
export function chooseVoice(f: Findings, cjk: boolean): VoiceChoice {
  const g = f.genre;
  if (g) {
    const voice = !cjk && g.type.voice === "ink" ? "mv-card" : g.type.voice;
    return { voice, params: voice === g.type.voice ? { ...(g.type.params ?? {}) } : { density: 0.25 }, why: `${g.label}的字體語法：${g.type.note}。` };
  }
  const a = f.audio;
  const emo = f.lyrics.emotion.label;
  switch (a.quadrant) {
    case "release":
      return { voice: "mv-card", params: { scaleContrast: 0.9 }, why: "安靜與爆發的反差很大：用日系字卡的極端字級對比，安靜時字很小、副歌時巨大。" };
    case "cold-drive":
      return a.arousal >= 0.68
        ? { voice: "glitch", params: {}, why: "冷冽又快的推進：切片、錯位與殘影，拍點上的抖動跟著節奏走（仍在 LED 安全的閃爍限制內）。" }
        : { voice: "title-sequence", params: { texture: 0.15 }, why: "冷調的推進：像電影片頭的瑞士網格與細線，字就是形狀。" };
    case "warm-groove":
      return { voice: "title-sequence", params: { motionIntensity: 0.45 }, why: "溫暖的律動：動態海報式的堆疊與滑入，跟著 groove 呼吸。" };
    case "dark-slow":
      return cjk
        ? { voice: "ink", params: {}, why: "慢而暗的歌：楷書依筆順寫出來，暈染與飛白，大量留白。" }
        : { voice: "mv-card", params: { density: 0.2, motionSpeed: 0.3 }, why: "慢而暗的歌：大留白的字卡，字很少、很安靜。" };
    case "gentle-float":
      return cjk && LYRICAL.has(emo)
        ? { voice: "ink", params: { density: 0.3 }, why: `抒情的歌（${emo}）：書法與水墨，字慢慢暈開。` }
        : { voice: "mv-card", params: { density: 0.22, motionSpeed: 0.35 }, why: "溫柔漂浮的歌：大留白的日系字卡，字像懸在空中。" };
  }
}

const CHANT = /\b(hey|oh+|yeah|woah|whoa|la+|na+|go)\b|嘿|喔|哦|啦啦/i;

/**
 * The words of a line the crowd holds on to: its chant, the sing-along phrase (when it is only part
 * of the line), then its strongest images (longest first). Exact substrings, at most two.
 */
export function lineEmphasis(line: LyricLine, f: Findings): string[] {
  const text = line.text ?? "";
  const out: string[] = [];
  // round 14: a dark word (blood, a weapon, death…) is never blown up, nor a phrase that carries one
  const dark = sensitiveWords(text);
  const safe = (w: string) => !dark.some((d) => w.includes(d) || d.includes(w));
  const chant = CHANT.exec(text)?.[0];
  if (chant) out.push(chant);
  const phrase = f.hints.singalong.find((p) => !p.chant && p.lineIds.includes(line.id) && Array.from(p.text).length <= Array.from(text).length * 0.6);
  if (phrase && text.includes(phrase.text) && safe(phrase.text) && !out.some((e) => e.includes(phrase.text) || phrase.text.includes(e))) out.push(phrase.text);
  const surfaces = f.imagery.flatMap((h) => h.surfaces).sort((a, b) => Array.from(b).length - Array.from(a).length);
  for (const w of surfaces) {
    if (out.length >= 2) break;
    if (w && text.includes(w) && safe(w) && !out.some((e) => e.includes(w) || w.includes(e))) out.push(w);
  }
  return out.slice(0, 2);
}

/** The line's motion word: the motion table first, then its image when the lexicon says it moves. */
export function lineMotion(line: LyricLine, f: Findings): string {
  const text = line.text ?? "";
  // round 14: a line with a dark word holds still (no dripping, no splatter)
  if (sensitiveWords(text).length) return "";
  const own = findMotionWord(text);
  if (own) return own;
  for (const h of f.imagery) {
    if (h.family.motion === "still") continue;
    const w = [...h.surfaces].sort((a, b) => Array.from(b).length - Array.from(a).length).find((s) => s && text.includes(s));
    if (w) return w;
  }
  return "";
}

/** The most repeated lyric (the hook), by its repetition key; null when nothing repeats. */
export function hookKeyOf(lines: readonly LyricLine[]): string | null {
  const count = new Map<string, number>();
  for (const l of lines) {
    const k = textKey(l.text ?? "");
    if (k) count.set(k, (count.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 1;
  for (const [k, c] of count) if (c > n) [best, n] = [k, c];
  return best;
}

/**
 * How much the verses may say, as typographic intensity: the band's lyric policy when it has a bible,
 * else a sparse or dense genre keeps the verses restrained (every line still appears).
 */
export function typePolicy(bible: BandBible | null | undefined, f: Findings | null): "chorus-only" | "full" | "minimal" | null {
  if (bible) return bible.lyricPolicy?.mode ?? null;
  const d = f?.genre?.lyrics.density;
  return d === "sparse" || d === "dense" ? "chorus-only" : null;
}

/** 1–2 CJK characters for the ink voice's seal: the band's name, else the song's title. */
export function sealText(bandName: string | undefined, title: string | undefined): string {
  const cjk = (s: string | undefined) => Array.from(s ?? "").filter((ch) => /\p{Script=Han}/u.test(ch));
  const band = cjk(bandName);
  if (band.length) return band.slice(0, 2).join("");
  return cjk(title).slice(0, 2).join("");
}

export interface TypeDesignInput {
  lines: readonly LyricLine[];
  sections: readonly SectionDesign[];
  duration: number;
  findings: Findings;
  cjk: boolean;
  /** the band's bible when it decides anything (its fonts are a hard constraint) */
  bible: BandBible | null;
  /** the plan's key-visual fonts (kept when they speak the voice) */
  planFonts?: { cjk: FontId; latin: FontId; weight?: number } | null;
  /** a forced voice (a design direction), else the song's */
  voice?: TypeVoiceId;
  params?: Partial<TypeParams>;
  /** the plan's emphasized lines (their emphasis leads) */
  lineDesigns?: readonly LineDesign[];
  bandName?: string;
  title?: string;
  /** 重新生成: another draw of the same rules */
  salt?: number;
}

const unit = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;

/** The rule-based type system for a song: its voice, parameters, fonts and a hint for every line. */
export function designTypeSystem(input: TypeDesignInput): { system: TypeSystem; choice: VoiceChoice } {
  const f = input.findings;
  const own = chooseVoice(f, input.cjk);
  const choice: VoiceChoice = input.voice ? { voice: input.voice, params: input.voice === own.voice ? own.params : {}, why: input.voice === own.voice ? own.why : VOICES[input.voice].description } : own;
  const d = VOICES[choice.voice];
  const merged: TypeParams = { ...d.params };
  for (const [k, v] of Object.entries({ ...choice.params, ...(input.params ?? {}) }) as Array<[keyof TypeParams, number]>) {
    if (typeof v === "number" && Number.isFinite(v)) merged[k] = k === "gridColumns" ? Math.round(Math.min(12, Math.max(2, v))) : unit(v);
  }
  const fonts = input.bible ? voiceFonts(choice.voice, { cjk: input.bible.fonts.cjkFont, latin: input.bible.fonts.latinFont }, true) : voiceFonts(choice.voice, input.planFonts ?? null);
  const weight = input.bible ? Math.max(600, Math.round(input.bible.fonts.weight / 100) * 100) : d.weight;
  const emphasisOf = new Map((input.lineDesigns ?? []).filter((l) => l.emphasis.length).map((l) => [l.lineId, l.emphasis] as const));
  const seal = choice.voice === "ink" ? sealText(input.bandName, input.title) : "";
  const ornaments = seal || choice.voice !== "ink" ? d.ornaments : d.ornaments.filter((o) => o !== "seal");
  const draft = {
    voice: choice.voice,
    params: merged,
    color: d.color,
    fonts,
    weight,
    ornaments,
    seal,
    rationale: choice.why,
    lines: [],
  };
  const { system } = normalizeTypeSystem(draft, {
    lines: input.lines,
    sections: input.sections,
    duration: input.duration,
    voice: choice.voice,
    fonts: { cjk: fonts.cjk, latin: fonts.latin },
    emphasisFor: (line) => emphasisOf.get(line.id) ?? lineEmphasis(line, f),
    motionFor: (line) => lineMotion(line, f),
    policy: typePolicy(input.bible, f),
    hookKey: hookKeyOf(input.lines),
  });
  if (input.salt) return { system: { ...system, generation: input.salt }, choice };
  return { system, choice };
}

/** The recipes a system uses most (for notes and cards), most frequent first. */
export function topRecipes(system: TypeSystem, n = 4): TypeRecipeId[] {
  const count = new Map<TypeRecipeId, number>();
  for (const l of system.lines) count.set(l.recipe, (count.get(l.recipe) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}

/** The 字體語言 paragraph of the designer notes (繁中 Markdown lines). */
export function typeNotes(system: TypeSystem, sections: readonly SectionDesign[]): string[] {
  if (!system.lines.length) return [];
  const v = VOICES[system.voice];
  const recipes = topRecipes(system).map((id) => `「${RECIPES[id].label}」`).join("、");
  const byKind = (kinds: readonly string[]) => {
    const ids = new Set(sections.filter((s) => kinds.includes(s.kind)).map((s) => s.id));
    return ids.size > 0;
  };
  return [
    "## 字體語言",
    `- ${v.label}：${system.rationale || v.description}`,
    `- 每一句歌詞都是一張排好的構圖，不是字幕：這首歌主要用${recipes}，相鄰的句子換構圖與位置，重複的句子沿用同一個構圖讓全場認得${byKind(["chorus"]) ? "，最後一次副歌再放大" : ""}。`,
    "- 所有構圖都守住最小字級、閱讀順序與中文排版的禁則，避開畫面下緣；到「排版」頁可以逐句調整構圖、強調字、位置與進出場。",
    "",
  ];
}
