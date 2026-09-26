// The closed vocabularies of the DesignPlan with designer-facing descriptions
// (Traditional Chinese), used in Claude's prompt, by the offline designer and by
// normalizePlan. Records are keyed by the schema enums so a new id cannot be added
// without describing it here.
//
// Font metadata mirrors src/lib/fonts.ts (which imports next/font and therefore cannot
// be loaded outside the Next compiler); catalog.test.ts checks the two stay in sync.

import type { FontId, LyricPlacement, LyricStyleId, SceneId, SectionKind } from "@/lib/types";

export interface SceneInfo {
  label: string;
  description: string;
  /** energy range where the scene feels natural */
  energy: [number, number];
}

export const SCENES: Record<SceneId, SceneInfo> = {
  nebula: { label: "星雲", description: "流動的 fbm 雲霧與色煙，柔和、夢幻、有深度；適合抒情主歌、橋段、前奏。", energy: [0.1, 0.6] },
  particles: {
    label: "粒子",
    description: "漂浮的粒子場／星空，會隨拍點脈動；中高能量都能用，副歌時密度拉高就是一片燈海。",
    energy: [0.3, 0.95],
  },
  waves: { label: "波形", description: "層疊的正弦光帶／示波器線條，律動感強但不搶戲；適合主歌、導歌、律動型段落。", energy: [0.25, 0.75] },
  grid: { label: "網格", description: "復古透視網格與地平線光暈（synthwave），有速度感與前進感；適合電子、搖滾副歌。", energy: [0.5, 1] },
  tunnel: { label: "隧道", description: "向觀眾衝來的放射環狀隧道，強烈的衝刺感；留給最高潮、drop、最後一次副歌。", energy: [0.65, 1] },
  rain: { label: "雨絲", description: "垂直落下的光絲／雨／流星線條，帶憂鬱或洗滌感；適合 breakdown、悲傷段落、雨的意象。", energy: [0.1, 0.6] },
  bokeh: { label: "光斑", description: "柔焦的圓形光球，溫暖、城市夜色、回憶感；適合前奏、抒情主歌、尾奏。", energy: [0.05, 0.5] },
  shards: { label: "碎片", description: "Voronoi 碎片／彩繪玻璃／破碎玻璃，張力與衝突感；適合激烈副歌、solo、情緒爆發。", energy: [0.55, 1] },
  ink: { label: "水墨", description: "高對比、域扭曲的墨流，東方、文學、神秘；適合詩意主歌、橋段、直排歌詞。", energy: [0.15, 0.7] },
  motif: {
    label: "主視覺符號",
    description: "主視覺 SVG 符號平鋪／環繞／脈動；用在開場建立識別、關鍵轉折或結尾回到主視覺。",
    energy: [0.15, 0.8],
  },
  gradient: { label: "漸層", description: "平靜極簡的漸層色場，讓歌詞成為主角；適合敘事句、安靜段落、尾奏。", energy: [0, 0.45] },
  blackout: { label: "全黑", description: "純黑（刻意的黑暗），把焦點完全還給舞台燈光與樂手；用於極安靜的瞬間或刻意留白。", energy: [0, 0.25] },
};

export interface LyricStyleInfo {
  label: string;
  description: string;
}

export const LYRIC_STYLES: Record<LyricStyleId, LyricStyleInfo> = {
  karaoke: { label: "卡拉 OK 填色", description: "整行先出現，填色逐字掃過；群眾先看到字才能跟唱，適合大合唱副歌（需要準確時間）。" },
  "line-fade": { label: "整行淡入", description: "整行模糊淡入、再淡出；最穩定、最好讀的預設，適合主歌與敘事句。" },
  "word-pop": { label: "逐字彈出", description: "詞語一個個帶縮放彈出；有能量與節奏感，適合快歌副歌、口號。" },
  typewriter: { label: "打字機", description: "字元依序出現；有敘事與懸念感，適合導歌、獨白、慢而有力的句子（不適合快歌）。" },
  stack: { label: "詩句堆疊", description: "歌詞像詩一樣一行行往上堆疊、舊行變暗；讓觀眾看見整段文字，適合抒情段落、橋段。" },
  vertical: { label: "直排", description: "中日文直排（writing-mode: vertical-rl），帶文學與海報感；只用在短而詩意的中文句子。" },
  impact: { label: "巨字衝擊", description: "巨大粗體字塞滿畫面、一次只出現幾個字；用在 hook、口號、全場一起喊的瞬間。" },
  subtitle: { label: "字幕", description: "小而安靜的下方字幕，畫面為主；適合視覺主導的主歌、字很密的段落。" },
  hidden: { label: "不顯示", description: "不顯示歌詞；前奏、間奏、solo、純器樂段落，或讓畫面／燈光當主角的段落。" },
};

export const LYRIC_PLACEMENTS_INFO: Record<LyricPlacement, string> = {
  center: "畫面正中央：最醒目，適合副歌與關鍵句；注意不要壓在主唱 IMAG 的臉上。",
  "lower-third": "下三分之一：字幕感、低調；注意畫面最下緣常被觀眾的頭、旗子與手機擋住。",
  "upper-third": "上三分之一：避開人頭遮擋與中央 IMAG，是大型戶外舞台很好的歌詞位置。",
  left: "畫面左側：與右側的主唱或 IMAG 錯開，適合堆疊詩句。",
  right: "畫面右側：與左側的主唱或 IMAG 錯開。",
  "vertical-right": "右側直排欄：搭配直排歌詞，海報感。",
  "vertical-left": "左側直排欄：搭配直排歌詞。",
};

export interface FontCatalogEntry {
  label: string;
  cjk: boolean;
  generic: "sans-serif" | "serif" | "cursive";
  description: string;
}

export const FONT_CATALOG: Record<FontId, FontCatalogEntry> = {
  "noto-sans-tc": { label: "思源黑體", cjk: true, generic: "sans-serif", description: "中性、最易讀的黑體，LED 上最穩定的安全選擇。" },
  "noto-serif-tc": { label: "思源宋體", cjk: true, generic: "serif", description: "文學、優雅的明朝體，適合抒情與敘事歌（粗細要 600 以上）。" },
  "lxgw-wenkai-tc": { label: "霞鶩文楷", cjk: true, generic: "serif", description: "溫暖的手寫楷書，適合民謠、溫柔、懷舊。" },
  huninn: { label: "粉圓", cjk: true, generic: "sans-serif", description: "圓體，友善、可愛、青春；適合輕快流行。" },
  "chiron-hei-hk": { label: "昭源黑體", cjk: true, generic: "sans-serif", description: "現代感粗黑體，有力量；適合搖滾、電子、熱血。" },
  iansui: { label: "芫荽", cjk: true, generic: "cursive", description: "手寫感、俏皮；適合輕鬆、童趣、獨立樂團。" },
  "cactus-classical-serif": { label: "仙人掌明體", cjk: true, generic: "serif", description: "古典舊式明體，復古、詩意、東方。" },
  "bebas-neue": { label: "Bebas Neue", cjk: false, generic: "sans-serif", description: "拉丁窄體大寫展示字，口號與英文 hook 很有力。" },
  anton: { label: "Anton", cjk: false, generic: "sans-serif", description: "拉丁超粗窄體，衝擊感最強。" },
  "space-grotesk": { label: "Space Grotesk", cjk: false, generic: "sans-serif", description: "幾何怪誕體，現代、乾淨，配黑體最自然。" },
  "playfair-display": { label: "Playfair Display", cjk: false, generic: "serif", description: "高對比襯線，優雅；配宋體、楷書。" },
};

export function isCjkFont(id: FontId): boolean {
  return FONT_CATALOG[id].cjk;
}

export const TRANSITIONS: Record<"cut" | "fade" | "flash" | "wipe" | "bloom", string> = {
  cut: "硬切：精準落在重拍上的瞬間切換。",
  fade: "淡入淡出：平順、安靜段落的預設。",
  flash: "閃白：爆點、drop、副歌第一拍。",
  wipe: "擦除：有方向感的推進，段落換場。",
  bloom: "光暈綻放：溫柔地亮起來，適合進入抒情段落。",
};

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  intro: "前奏",
  verse: "主歌",
  "pre-chorus": "導歌",
  chorus: "副歌",
  bridge: "橋段",
  solo: "獨奏",
  breakdown: "Breakdown",
  outro: "尾奏",
  interlude: "間奏",
};
