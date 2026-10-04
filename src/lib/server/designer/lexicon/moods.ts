// Audio mood → the designer's fallback vocabulary when a song has no lyric imagery and no genre (an
// instrumental, a stub-down research, a demo without words): motifs, scenes, keywords and a title
// pool per mood quadrant, curated like the imagery and genre lexicons so no brief ever says
// 「母題：一個簡單的幾何符號」 or 「場景：。」.

import type { SceneId } from "@/lib/types";
import type { MoodQuadrant } from "../audio-mood";

export interface MoodVocabulary {
  /** motif phrases for the key visual, most typical first */
  motifs: string[];
  /** scene family, most typical first */
  scenes: SceneId[];
  /** mood keywords (繁中, ≤ 4 characters) */
  keywords: string[];
  /** key-visual titles when the song gives no image to name */
  titles: string[];
}

export const MOOD_VOCABULARY: Record<MoodQuadrant, MoodVocabulary> = {
  release: {
    motifs: ["收攏再炸開的光束", "黑暗裡的一道裂光", "逐漸撐滿畫面的光牆"],
    scenes: ["particles", "nebula", "tunnel", "shards"],
    keywords: ["爆發", "反差", "蓄勢"],
    titles: ["暗處的一道光", "撐開的黑", "靜到爆開"],
  },
  "cold-drive": {
    motifs: ["向前衝的冷光線條", "深夜公路的車燈拖尾", "鋼鐵色的脈衝"],
    scenes: ["grid", "tunnel", "waves", "particles"],
    keywords: ["推進", "冷冽", "速度"],
    titles: ["冷光直行", "深夜的直線", "鋼色脈衝"],
  },
  "warm-groove": {
    motifs: ["跟著拍子呼吸的暖光", "舞台燈的琥珀光暈", "搖擺的光帶"],
    scenes: ["bokeh", "waves", "particles", "gradient"],
    keywords: ["律動", "溫暖", "搖擺"],
    titles: ["琥珀的拍子", "暖光搖擺", "呼吸的光"],
  },
  "dark-slow": {
    motifs: ["緩慢沉下去的色場", "大片留白裡的一點光", "慢速流動的墨"],
    scenes: ["gradient", "ink", "nebula", "rain"],
    keywords: ["沉靜", "留白", "緩慢"],
    titles: ["沉下去的光", "留白之夜", "慢慢暗下來"],
  },
  "gentle-float": {
    motifs: ["漂浮的柔光粒子", "失焦的光斑", "慢慢暈開的色彩"],
    scenes: ["bokeh", "gradient", "nebula", "particles"],
    keywords: ["漂浮", "柔和", "溫柔"],
    titles: ["漂浮的微光", "柔焦的早晨", "輕輕亮起"],
  },
};
