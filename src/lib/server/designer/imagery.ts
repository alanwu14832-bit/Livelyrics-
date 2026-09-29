// A small lexicon of lyric imagery -> visual vocabulary, used by the offline designer
// to make heuristic plans feel lyric-driven (hue, scene and emblem biases, motif names).

import type { SceneId } from "@/lib/types";
import type { EmblemStyle } from "./svg";

export interface Imagery {
  /** mood keyword / short motif name (繁中) */
  name: string;
  /** motif phrase for the key visual */
  motif: string;
  words: string[];
  hue: number;
  scene: SceneId;
  emblem: EmblemStyle;
  /** saturation multiplier (snow / ink are muted) */
  saturation?: number;
}

export const IMAGERY: Imagery[] = [
  { name: "夜色", motif: "入夜的城市燈火", words: ["夜色", "深夜", "午夜", "夜晚", "黑夜", "今夜", "夜", "晚上", "night", "midnight"], hue: 235, scene: "bokeh", emblem: "orbit" },
  { name: "星空", motif: "星光粒子", words: ["星空", "星星", "銀河", "宇宙", "流星", "星", "star", "stars", "galaxy", "universe"], hue: 250, scene: "particles", emblem: "crystal" },
  { name: "月光", motif: "月亮與光暈", words: ["月亮", "月光", "月", "moon", "moonlight"], hue: 220, scene: "bokeh", emblem: "orbit" },
  { name: "燈火", motif: "一盞盞燈火", words: ["燈火", "燈光", "點亮", "燈", "光芒", "光", "light", "lights", "shine"], hue: 38, scene: "particles", emblem: "sun" },
  { name: "火焰", motif: "燃燒的火焰", words: ["燃燒", "點燃", "火焰", "火花", "火", "燃", "fire", "burn", "flame"], hue: 16, scene: "shards", emblem: "shard" },
  { name: "海浪", motif: "潮汐與浪花", words: ["海浪", "海洋", "大海", "潮汐", "浪花", "海", "浪", "潮", "sea", "ocean", "wave", "waves", "tide"], hue: 198, scene: "waves", emblem: "wave" },
  { name: "雨", motif: "落下的雨絲", words: ["雨天", "下雨", "雨水", "雨", "眼淚", "淚", "rain", "tears", "cry"], hue: 212, scene: "rain", emblem: "wave", saturation: 0.8 },
  { name: "風", motif: "被風吹散的字", words: ["風中", "微風", "風", "吹", "wind", "breeze"], hue: 170, scene: "waves", emblem: "wave" },
  { name: "花", motif: "綻放的花", words: ["花瓣", "花開", "玫瑰", "櫻花", "花", "flower", "flowers", "rose", "bloom"], hue: 335, scene: "bokeh", emblem: "bloom" },
  { name: "雪", motif: "雪與冰晶", words: ["雪花", "下雪", "冬天", "冰", "雪", "snow", "winter", "ice"], hue: 200, scene: "particles", emblem: "crystal", saturation: 0.45 },
  { name: "城市", motif: "霓虹城市天際線", words: ["城市", "街道", "街頭", "街", "霓虹", "city", "street", "neon"], hue: 265, scene: "grid", emblem: "crystal" },
  { name: "夢境", motif: "漂浮的夢境", words: ["夢想", "夢境", "作夢", "夢", "dream", "dreams"], hue: 282, scene: "nebula", emblem: "orbit" },
  { name: "心跳", motif: "心跳脈動", words: ["心跳", "心臟", "心動", "heartbeat", "heart"], hue: 350, scene: "particles", emblem: "sun" },
  { name: "天空", motif: "天空與雲層", words: ["天空", "雲朵", "藍天", "雲", "sky", "cloud", "clouds"], hue: 205, scene: "nebula", emblem: "orbit" },
  { name: "黎明", motif: "天亮的地平線", words: ["天亮", "黎明", "日出", "陽光", "太陽", "清晨", "sunrise", "dawn", "sun", "sunshine"], hue: 40, scene: "gradient", emblem: "sun" },
  { name: "黑暗", motif: "黑暗中的裂縫", words: ["黑暗", "深淵", "陰影", "dark", "darkness", "shadow"], hue: 262, scene: "ink", emblem: "shard", saturation: 0.7 },
  { name: "遠方", motif: "通往遠方的路", words: ["遠方", "方向", "旅程", "道路", "出發", "路", "road", "journey", "way", "away"], hue: 188, scene: "tunnel", emblem: "wave" },
  { name: "山林", motif: "山與森林的剪影", words: ["森林", "山谷", "山", "樹", "forest", "mountain", "tree"], hue: 140, scene: "ink", emblem: "crystal" },
  { name: "筆墨", motif: "書寫的筆墨", words: ["寫下", "名字", "詩", "字", "墨", "write", "words", "poem"], hue: 160, scene: "ink", emblem: "shard", saturation: 0.6 },
  { name: "時光", motif: "時光與回憶", words: ["時光", "回憶", "記憶", "從前", "時間", "昨天", "memory", "time", "yesterday"], hue: 30, scene: "bokeh", emblem: "orbit" },
  { name: "飛翔", motif: "張開的翅膀", words: ["自由", "飛翔", "翅膀", "飛", "free", "freedom", "fly", "wings"], hue: 192, scene: "particles", emblem: "bloom" },
  { name: "碎片", motif: "破碎的玻璃", words: ["破碎", "碎片", "玻璃", "碎", "broken", "glass", "shatter"], hue: 300, scene: "shards", emblem: "shard" },
];

export interface ImageryHit {
  imagery: Imagery;
  count: number;
  /** the matched words, longest first */
  words: string[];
}

function countWord(haystack: string, word: string): number {
  if (/^[a-z]+$/i.test(word)) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    return haystack.match(re)?.length ?? 0;
  }
  let n = 0;
  let at = haystack.indexOf(word);
  while (at >= 0) {
    n++;
    at = haystack.indexOf(word, at + word.length);
  }
  return n;
}

/** Imagery found in the lyrics (+ title, weighted double), most frequent first. */
export function findImagery(lines: readonly string[], title = ""): ImageryHit[] {
  const body = lines.join("\n");
  const hits: ImageryHit[] = [];
  for (const imagery of IMAGERY) {
    let count = 0;
    const words: string[] = [];
    // longer words first; each character run is only counted once per entry
    let remaining = body;
    let remainingTitle = title;
    for (const w of [...imagery.words].sort((a, b) => b.length - a.length)) {
      const c = countWord(remaining, w) + 2 * countWord(remainingTitle, w);
      if (c > 0) {
        count += c;
        words.push(w);
        remaining = remaining.split(w).join(" ");
        remainingTitle = remainingTitle.split(w).join(" ");
      }
    }
    if (count > 0) hits.push({ imagery, count, words });
  }
  return hits.sort((a, b) => b.count - a.count || IMAGERY.indexOf(a.imagery) - IMAGERY.indexOf(b.imagery));
}
