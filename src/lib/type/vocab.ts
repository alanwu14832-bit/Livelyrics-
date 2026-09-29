// 字體藝術 (phase 6): the closed vocabularies of the type system with their designer-facing
// descriptions (Traditional Chinese) and each voice's grammar — which recipes it favours, its
// motion vocabulary, its default parameters, fonts and ornaments. Shared by the renderer, the
// designers (Claude prompt, offline / free rules, directions), normalizePlan and the 排版 editor.

import type {
  FontId,
  TypeColorRole,
  TypeColorTreatment,
  TypeEnterId,
  TypeExitId,
  TypeOrnamentId,
  TypeParams,
  TypeRecipeId,
  TypeVoiceId,
} from "../schema";

/** How a line moves while it holds (driven by its motion word). */
export type MotionKind = "still" | "drift" | "fall" | "flicker" | "pulse" | "wave" | "rise" | "bloom" | "shatter" | "rush" | "spin";

export const MOTION_KINDS: readonly MotionKind[] = ["still", "drift", "fall", "flicker", "pulse", "wave", "rise", "bloom", "shatter", "rush", "spin"];

export interface VoiceInfo {
  label: string;
  short: string;
  description: string;
  /** recipes this voice favours, with weights (the sequencer draws from these) */
  recipes: Partial<Record<TypeRecipeId, number>>;
  /** default song-level parameters */
  params: TypeParams;
  color: TypeColorTreatment;
  fonts: { cjk: FontId; latin: FontId };
  /** faces that speak this voice (a plan's or a bible's font is kept when it is one of them) */
  fontsOk: { cjk: FontId[]; latin: FontId[] };
  weight: number;
  ornaments: TypeOrnamentId[];
  /** default entrance / exit when a line says "auto" */
  enter: TypeEnterId;
  exit: TypeExitId;
  /** entrances snap to the beat (MV cards, glitch stutter) */
  snap: boolean;
  /** motion amplitude and speed multipliers of the voice (ink is slow and organic, glitch nervous) */
  motionScale: number;
  speedScale: number;
}

export const VOICES: Record<TypeVoiceId, VoiceInfo> = {
  "mv-card": {
    label: "日系 MV 字卡",
    short: "MV 字卡",
    description: "極端的字級對比、直橫混排、大量留白與不對稱網格；字卡在拍點上硬切進出，「」括號當成圖形，黑白加一個點綴色。",
    recipes: { "giant-word": 5, "vertical-column": 4, cross: 4, whisper: 2, "grid-poem": 2, echo: 1.5, window: 1, "title-card": 1 },
    params: { scaleContrast: 0.85, density: 0.3, verticalRatio: 0.55, gridColumns: 6, gridMargin: 0.55, motionSpeed: 0.45, motionIntensity: 0.3, texture: 0.15, ornament: 0.45 },
    color: "solid",
    fonts: { cjk: "noto-serif-tc", latin: "playfair-display" },
    fontsOk: { cjk: ["noto-serif-tc", "cactus-classical-serif", "noto-sans-tc", "chiron-hei-hk", "lxgw-wenkai-tc"], latin: ["playfair-display", "space-grotesk", "bebas-neue"] },
    weight: 800,
    ornaments: ["bracket", "number", "rule"],
    enter: "cut",
    exit: "cut",
    snap: true,
    motionScale: 0.55,
    speedScale: 0.8,
  },
  "title-sequence": {
    label: "電影片頭／動態海報",
    short: "片頭海報",
    description: "字就是形狀：出血的巨字、瑞士網格、細線與編號、遮罩滑入的擦除；拉丁字與中文配對，最粗的字重。",
    recipes: { poster: 4, bleed: 4, "title-card": 3, window: 3, "giant-word": 2, "grid-poem": 2, whisper: 1 },
    params: { scaleContrast: 0.75, density: 0.55, verticalRatio: 0.15, gridColumns: 12, gridMargin: 0.35, motionSpeed: 0.55, motionIntensity: 0.35, texture: 0.1, ornament: 0.7 },
    color: "knockout",
    fonts: { cjk: "noto-sans-tc", latin: "bebas-neue" },
    fontsOk: { cjk: ["noto-sans-tc", "chiron-hei-hk", "noto-serif-tc", "cactus-classical-serif"], latin: ["bebas-neue", "anton", "space-grotesk", "playfair-display"] },
    weight: 900,
    ornaments: ["rule", "number", "section", "title"],
    enter: "wipe",
    exit: "wipe",
    snap: false,
    motionScale: 0.6,
    speedScale: 1,
  },
  ink: {
    label: "書法與水墨",
    short: "水墨",
    description: "毛筆的暈染與飛白、依書寫順序出現的字、以直排為主的楷書，加一方紅色印章；動態緩慢而有機。",
    recipes: { "brush-write": 5, "vertical-column": 4, whisper: 2, scatter: 2, cross: 2, "giant-word": 2 },
    params: { scaleContrast: 0.6, density: 0.35, verticalRatio: 0.85, gridColumns: 5, gridMargin: 0.6, motionSpeed: 0.3, motionIntensity: 0.4, texture: 0.65, ornament: 0.5 },
    color: "solid",
    fonts: { cjk: "lxgw-wenkai-tc", latin: "playfair-display" },
    fontsOk: { cjk: ["lxgw-wenkai-tc", "iansui", "cactus-classical-serif"], latin: ["playfair-display"] },
    weight: 700,
    ornaments: ["seal", "rule"],
    enter: "write",
    exit: "dissolve",
    snap: false,
    motionScale: 0.8,
    speedScale: 0.6,
  },
  glitch: {
    label: "實驗／故障感",
    short: "故障",
    description: "切片與錯位、RGB 分離、殘影、疊印與顆粒，字被場景吃掉一部分；拍點上有種子決定的抖動（仍在 LED 安全的閃爍限制內）。",
    // phase 7: a terminal-like grid and data labels (section codes, numbers) give the experimental
    // voice its own structure; the tears and echoes stay, big-only recipes are rarer
    recipes: { split: 5, echo: 3.5, "grid-poem": 3.5, scatter: 2, poster: 1.5, bleed: 1, window: 1 },
    params: { scaleContrast: 0.6, density: 0.55, verticalRatio: 0.2, gridColumns: 8, gridMargin: 0.3, motionSpeed: 0.75, motionIntensity: 0.65, texture: 0.7, ornament: 0.6 },
    color: "overprint",
    fonts: { cjk: "chiron-hei-hk", latin: "space-grotesk" },
    fontsOk: { cjk: ["chiron-hei-hk", "noto-sans-tc"], latin: ["space-grotesk", "anton", "bebas-neue"] },
    weight: 800,
    ornaments: ["number", "section", "rule"],
    enter: "glitch",
    exit: "glitch",
    snap: true,
    motionScale: 1,
    speedScale: 1.2,
  },
};

/**
 * The voice's font pairing for a song: the preferred faces (the band bible's, or the plan's key
 * visual) when they speak this voice, else the voice's own. A bible's fonts are a hard constraint:
 * pass `strict` to keep them whatever the voice.
 */
export function voiceFonts(voice: TypeVoiceId, preferred?: { cjk?: FontId | null; latin?: FontId | null } | null, strict = false): { cjk: FontId; latin: FontId } {
  const v = VOICES[voice];
  const cjk = preferred?.cjk && (strict || v.fontsOk.cjk.includes(preferred.cjk)) ? preferred.cjk : v.fonts.cjk;
  const latin = preferred?.latin && (strict || v.fontsOk.latin.includes(preferred.latin)) ? preferred.latin : v.fonts.latin;
  return { cjk, latin };
}

export interface RecipeInfo {
  label: string;
  description: string;
  /** orientations the recipe can realize (others fall back to its first) */
  orientations: Array<"h" | "v" | "mixed">;
  /** a CJK-only recipe (vertical text) falls back for Latin lines */
  cjkOnly?: boolean;
  /** typical energy: quiet recipes (whisper) never serve a loud chorus */
  energy: [number, number];
}

export const RECIPES: Record<TypeRecipeId, RecipeInfo> = {
  "giant-word": { label: "巨字＋小字", description: "一個字（或詞）巨大，其餘小字貼著它的邊排；極端的字級對比。", orientations: ["mixed", "h", "v"], energy: [0.3, 1] },
  "vertical-column": { label: "直排欄", description: "一到兩欄直排，落在網格的一欄上，行距寬鬆。", orientations: ["v"], cjkOnly: true, energy: [0.1, 0.8] },
  cross: { label: "直橫交錯", description: "前半句直排、後半句橫排，在一個角落交會。", orientations: ["mixed"], cjkOnly: true, energy: [0.25, 0.9] },
  "grid-poem": { label: "網格詩", description: "每個字落在嚴格的格子上，像稿紙或瑞士網格，留下空格的節奏。", orientations: ["h", "v"], energy: [0.2, 0.8] },
  bleed: { label: "出血", description: "關鍵字大到跑出畫面邊緣，整句以可讀的大小排在旁邊。", orientations: ["h", "v"], energy: [0.5, 1] },
  scatter: { label: "散落", description: "字沿著閱讀路徑散落，大小與角度由種子決定，順序仍然清楚。", orientations: ["h", "v"], energy: [0.2, 0.8] },
  poster: { label: "海報堆疊", description: "幾行字堆疊並撐滿同一個寬度，粗字重，加上細線與標籤。", orientations: ["h"], energy: [0.45, 1] },
  window: { label: "鏤空窗", description: "巨大的字變成窗，只在字裡看見場景，畫面其他地方被填滿。", orientations: ["h", "v"], energy: [0.55, 1] },
  "brush-write": { label: "書寫", description: "依書寫順序一個字一個字寫出來的直排欄，可以蓋一方印章。", orientations: ["v", "h"], energy: [0.1, 0.8] },
  echo: { label: "殘影", description: "句子留下一串漸淡的殘影，適合重複的口號。", orientations: ["h", "v"], energy: [0.45, 1] },
  split: { label: "撕裂", description: "字被切成橫條錯開、RGB 分離，靜止時重新對齊。", orientations: ["h", "v"], energy: [0.4, 1] },
  whisper: { label: "低語", description: "很小、很節制、字距拉開，給安靜的句子。", orientations: ["h", "v"], energy: [0, 0.45] },
  "title-card": { label: "片名卡", description: "置中的片名卡：上下細線、字距寬、旁邊一行小小的拉丁標籤。", orientations: ["h", "v"], energy: [0.15, 0.75] },
};

export const ENTERS: Record<TypeEnterId, string> = {
  auto: "依字體語言",
  cut: "硬切",
  fade: "淡入",
  rise: "浮起",
  fall: "落下",
  wipe: "擦出",
  write: "書寫",
  scale: "放大",
  glitch: "故障",
  bloom: "綻光",
};

export const EXITS: Record<TypeExitId, string> = {
  auto: "依字體語言",
  cut: "硬切",
  fade: "淡出",
  sink: "沉下",
  wipe: "擦除",
  dissolve: "暈散",
  scale: "縮小",
  glitch: "故障",
  blur: "失焦",
};

export const COLOR_ROLES: Record<TypeColorRole | "auto", { label: string; description: string }> = {
  auto: { label: "自動", description: "跟整首的顏色處理（鏤空：強的句子巨字變成窗）" },
  ink: { label: "主字色", description: "歌詞色，最清楚" },
  accent: { label: "點綴色", description: "整句用點綴色" },
  invert: { label: "反白", description: "字從一塊色塊裡挖空" },
  window: { label: "鏤空", description: "字裡看見場景" },
};

export const COLOR_TREATMENTS: Record<TypeColorTreatment, { label: string; description: string }> = {
  solid: { label: "實色", description: "字是實心的顏色" },
  knockout: { label: "鏤空", description: "強的句子（副歌）巨字變成窗，在字裡看見場景" },
  overprint: { label: "疊印", description: "點綴色錯版疊印，像網版印刷" },
};

export const ORNAMENTS: Record<TypeOrnamentId, string> = {
  rule: "細線",
  number: "編號",
  section: "段落名",
  title: "歌名",
  seal: "印章",
  bracket: "「」括號",
};

export const MOTION_LABELS: Record<MotionKind, string> = {
  still: "靜止",
  drift: "飄動",
  fall: "落下",
  flicker: "閃爍",
  pulse: "心跳",
  wave: "波浪",
  rise: "從暗處浮起",
  bloom: "綻光",
  shatter: "碎裂",
  rush: "衝刺",
  spin: "旋轉",
};

export const PARAM_INFO: Record<keyof TypeParams, { label: string; low: string; high: string; integer?: [number, number] }> = {
  scaleContrast: { label: "字級對比", low: "平均", high: "極端" },
  density: { label: "密度", low: "留白", high: "填滿" },
  verticalRatio: { label: "直排比例", low: "橫排", high: "直排" },
  gridColumns: { label: "網格欄數", low: "2", high: "12", integer: [2, 12] },
  gridMargin: { label: "網格邊界", low: "窄", high: "寬" },
  motionSpeed: { label: "動態速度", low: "慢", high: "快" },
  motionIntensity: { label: "動態幅度", low: "克制", high: "強烈" },
  texture: { label: "質地", low: "乾淨", high: "粗糙" },
  ornament: { label: "裝飾", low: "無", high: "豐富" },
};

/** The spot colour of the seal (朱砂紅, tuned to stay readable on a dark stage). */
export const SEAL_COLOR = "#c8402f";
