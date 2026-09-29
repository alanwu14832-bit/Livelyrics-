// Motion words (動態意象詞): an imagery keyword in a lyric line decides how the line moves while
// it holds — 風 drifts, 雨 falls, 火 flickers, 心跳 pulses on the beat, 海 / 浪 wave, 夜 rises from
// the dark, 光 blooms. A compact, client-safe table (the offline designer's richer imagery lexicon
// maps onto the same kinds), matched longest word first.

import type { MotionKind } from "./vocab";

const TABLE: Array<[MotionKind, string[]]> = [
  ["pulse", ["心跳", "心臟", "脈搏", "心動", "節拍", "鼓聲", "心", "脈", "跳", "鼓", "heartbeat", "heart", "pulse", "beat", "drum", "drums"]],
  ["drift", ["微風", "狂風", "風中", "飄散", "飄落", "漂浮", "雲朵", "煙霧", "迷霧", "夢裡", "風", "吹", "飄", "漂", "浮", "雲", "霧", "煙", "夢", "塵", "wind", "breeze", "drift", "float", "floating", "cloud", "clouds", "smoke", "mist", "dream", "dreams"]],
  ["fall", ["下雨", "雨水", "眼淚", "淚水", "雪花", "下雪", "落葉", "墜落", "掉落", "雨", "淚", "雪", "落", "墜", "沉", "滴", "rain", "raining", "tear", "tears", "snow", "fall", "falling", "drop", "drops"]],
  ["flicker", ["燃燒", "火焰", "火花", "煙火", "霓虹", "星光", "星星", "閃爍", "蠟燭", "火", "燃", "燒", "焰", "星", "閃", "fire", "burn", "burning", "flame", "flames", "spark", "sparks", "star", "stars", "neon", "flicker"]],
  ["wave", ["海浪", "浪花", "潮汐", "大海", "海洋", "河流", "流水", "波浪", "海", "浪", "潮", "河", "流", "波", "湖", "洋", "水", "sea", "ocean", "wave", "waves", "tide", "river", "water", "flow"]],
  ["rise", ["天亮", "黎明", "日出", "破曉", "深夜", "黑夜", "夜晚", "今夜", "黑暗", "影子", "甦醒", "升起", "翅膀", "飛翔", "夜", "暗", "黑", "影", "升", "醒", "飛", "翼", "night", "tonight", "dark", "darkness", "shadow", "rise", "rising", "dawn", "wings", "fly"]],
  ["bloom", ["燈火", "光芒", "陽光", "太陽", "照亮", "點亮", "綻放", "盛開", "花開", "光", "亮", "燈", "照", "陽", "花", "開", "light", "lights", "shine", "shining", "sun", "sunshine", "glow", "bloom", "flower", "flowers", "bright"]],
  ["shatter", ["破碎", "碎片", "玻璃", "裂縫", "崩塌", "撕裂", "碎", "裂", "破", "崩", "撕", "broken", "shatter", "shattered", "crack", "break", "breaking"]],
  ["rush", ["奔跑", "奔向", "衝向", "遠方", "公路", "列車", "追逐", "跑", "奔", "衝", "追", "路", "run", "running", "rush", "chase", "road", "highway", "train", "fast"]],
  ["spin", ["旋轉", "宇宙", "軌道", "輪迴", "轉", "旋", "繞", "圈", "spin", "spinning", "turn", "around", "orbit", "universe"]],
];

const WORD_KIND = new Map<string, MotionKind>();
for (const [kind, words] of TABLE) for (const w of words) if (!WORD_KIND.has(w)) WORD_KIND.set(w, kind);
/** every word, longest first (so 心跳 wins over 心, 天亮 over 亮) */
const WORDS = [...WORD_KIND.keys()].sort((a, b) => b.length - a.length);

/** Compounds whose single characters mean nothing visual (開心 is not a blooming heart). */
const STOP = ["開心", "小心", "當心", "關心", "心情", "傷心", "擔心", "放心", "決心", "點心", "流行", "流利", "開始", "開口", "離開", "打開", "公開", "黑板", "落後", "跑步", "路上", "一路", "水準", "風格", "風險", "星期", "明星", "明天", "明白"];

function isLatin(s: string): boolean {
  return /^[a-z]+$/i.test(s);
}

/** The motion kind of a motion word (the word itself, else its characters); "still" when unknown. */
export function motionKindOf(word: string | null | undefined): MotionKind {
  const w = (word ?? "").trim().toLowerCase();
  if (!w) return "still";
  const direct = WORD_KIND.get(w);
  if (direct) return direct;
  for (const cand of WORDS) if (!isLatin(cand) && w.includes(cand)) return WORD_KIND.get(cand)!;
  return "still";
}

/**
 * The motion word of a line: the longest table word it contains (exactly as written in the line,
 * so it is always an exact substring), skipping stop compounds; "" when none.
 */
export function findMotionWord(text: string): string {
  const src = String(text ?? "");
  const lower = src.toLowerCase();
  // blank out the stop compounds so their characters do not match
  let masked = lower;
  for (const s of STOP) masked = masked.split(s).join("\u0000".repeat(s.length));
  for (const cand of WORDS) {
    if (isLatin(cand)) {
      const re = new RegExp(`\\b${cand}\\b`, "i");
      const m = re.exec(masked);
      if (m) return src.slice(m.index, m.index + cand.length);
      continue;
    }
    const at = masked.indexOf(cand);
    if (at >= 0) return src.slice(at, at + cand.length);
  }
  return "";
}

/** The type motion kind for an imagery family's lexicon motion (the offline designer's lexicon). */
export function motionFromLexicon(kind: string): MotionKind {
  switch (kind) {
    case "drift":
      return "drift";
    case "flow":
      return "wave";
    case "fall":
      return "fall";
    case "rise":
      return "rise";
    case "pulse":
      return "pulse";
    case "flicker":
      return "flicker";
    case "burst":
      return "shatter";
    case "rush":
      return "rush";
    case "spin":
      return "spin";
    default:
      return "still";
  }
}
