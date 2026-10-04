// The closed vocabularies of the DesignPlan with designer-facing descriptions
// (Traditional Chinese), used in Claude's prompt, by the offline designer and by
// normalizePlan. Records are keyed by the schema enums so a new id cannot be added
// without describing it here.
//
// Font label / script / generic family come from the shared registry in
// src/lib/font-meta.ts; only the designer-facing descriptions live here.

import { FONTS } from "@/lib/font-meta";
import { SCENE_LABELS } from "@/lib/stage/scenes/labels";
import type { MEDIA_BLENDS } from "@/lib/schema";
import type { FontId, LyricPlacement, LyricStyleId, MediaTreatment, SceneId, SectionKind } from "@/lib/types";

export interface SceneInfo {
  label: string;
  description: string;
  /** energy range where the scene feels natural */
  energy: [number, number];
}

const SCENE_INFO: Record<SceneId, Omit<SceneInfo, "label">> = {
  nebula: { description: "流動的 fbm 雲霧與色煙，柔和、夢幻、有深度；適合抒情主歌、橋段、前奏。", energy: [0.1, 0.6] },
  particles: { description: "漂浮的粒子場／星空，會隨拍點脈動；中高能量都能用，副歌時密度拉高就是一片燈海。",
    energy: [0.3, 0.95],
  },
  waves: { description: "層疊的正弦光帶／示波器線條，律動感強但不搶戲；適合主歌、導歌、律動型段落。", energy: [0.25, 0.75] },
  grid: { description: "復古透視網格與地平線光暈（synthwave），有速度感與前進感；適合電子、搖滾副歌。", energy: [0.5, 1] },
  tunnel: { description: "向觀眾衝來的放射環狀隧道，強烈的衝刺感；留給最高潮、drop、最後一次副歌。", energy: [0.65, 1] },
  rain: { description: "垂直落下的光絲／雨／流星線條，帶憂鬱或洗滌感；適合 breakdown、悲傷段落、雨的意象。", energy: [0.1, 0.6] },
  bokeh: { description: "柔焦的圓形光球，溫暖、城市夜色、回憶感；適合前奏、抒情主歌、尾奏。", energy: [0.05, 0.5] },
  shards: { description: "Voronoi 碎片／彩繪玻璃／破碎玻璃，張力與衝突感；適合激烈副歌、solo、情緒爆發。", energy: [0.55, 1] },
  ink: { description: "高對比、域扭曲的墨流，東方、文學、神秘；適合詩意主歌、橋段、直排歌詞。", energy: [0.15, 0.7] },
  motif: { description: "主視覺 SVG 符號平鋪／環繞／脈動；用在開場建立識別、關鍵轉折或結尾回到主視覺。",
    energy: [0.15, 0.8],
  },
  gradient: { description: "平靜極簡的漸層色場，讓歌詞成為主角；適合敘事句、安靜段落、尾奏。", energy: [0, 0.45] },
  blackout: { description: "純黑（刻意的黑暗），把焦點完全還給舞台燈光與樂手；用於極安靜的瞬間或刻意留白。", energy: [0, 0.25] },
};

/** Scene vocabulary with the shared operator-facing label (src/lib/stage/scenes/labels.ts). */
export const SCENES: Record<SceneId, SceneInfo> = Object.fromEntries((Object.keys(SCENE_INFO) as SceneId[]).map((id) => [id, { label: SCENE_LABELS[id], ...SCENE_INFO[id] }])) as Record<SceneId, SceneInfo>;

export interface LyricStyleInfo {
  label: string;
  description: string;
}

export const LYRIC_STYLES: Record<LyricStyleId, LyricStyleInfo> = {
  // karaoke and subtitle stay valid for old plans and the operator's own choice; no designer picks them (字體藝術)
  karaoke: { label: "卡拉 OK 填色", description: "（舊版樣式，自動設計不再使用）整行先出現，填色逐字掃過。" },
  "line-fade": { label: "整行淡入", description: "整行模糊淡入、再淡出；最穩定、最好讀的預設，適合主歌與敘事句。" },
  "word-pop": { label: "逐字彈出", description: "詞語一個個帶縮放彈出；有能量與節奏感，適合快歌副歌、口號。" },
  typewriter: { label: "打字機", description: "字元依序出現；有敘事與懸念感，適合導歌、獨白、慢而有力的句子（不適合快歌）。" },
  stack: { label: "詩句堆疊", description: "歌詞像詩一樣一行行往上堆疊、舊行變暗；讓觀眾看見整段文字，適合抒情段落、橋段。" },
  vertical: { label: "直排", description: "中日文直排（writing-mode: vertical-rl），帶文學與海報感；只用在短而詩意的中文句子。" },
  impact: { label: "巨字衝擊", description: "巨大粗體字塞滿畫面、一次只出現幾個字；用在 hook、口號、全場一起喊的瞬間。" },
  subtitle: { label: "字幕", description: "（舊版樣式，自動設計不再使用）小而安靜的下方字幕。" },
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

const FONT_DESCRIPTIONS: Record<FontId, string> = {
  "noto-sans-tc": "中性、最易讀的黑體，LED 上最穩定的安全選擇。",
  "noto-serif-tc": "文學、優雅的明朝體，適合抒情與敘事歌（粗細要 600 以上）。",
  "lxgw-wenkai-tc": "溫暖的手寫楷書，適合民謠、溫柔、懷舊。",
  huninn: "圓體，友善、可愛、青春；適合輕快流行。",
  "chiron-hei-hk": "現代感粗黑體，有力量；適合搖滾、電子、熱血。",
  iansui: "手寫感、俏皮；適合輕鬆、童趣、獨立樂團。",
  "cactus-classical-serif": "古典舊式明體，復古、詩意、東方。",
  "bebas-neue": "拉丁窄體大寫展示字，口號與英文 hook 很有力。",
  anton: "拉丁超粗窄體，衝擊感最強。",
  "space-grotesk": "幾何怪誕體，現代、乾淨，配黑體最自然。",
  "playfair-display": "高對比襯線，優雅；配宋體、楷書。",
};

export const FONT_CATALOG: Record<FontId, FontCatalogEntry> = Object.fromEntries(
  (Object.keys(FONT_DESCRIPTIONS) as FontId[]).map((id) => {
    const { label, cjk, generic } = FONTS[id];
    return [id, { label, cjk, generic, description: FONT_DESCRIPTIONS[id] }];
  }),
) as Record<FontId, FontCatalogEntry>;

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

export const MEDIA_TREATMENT_INFO: Record<MediaTreatment, { label: string; description: string }> = {
  full: { label: "原樣", description: "素材原樣呈現；適合本身就是完整作品的專輯封面、MV 畫面，或樂團指定要原色出現的時刻。" },
  duotone: { label: "雙色調", description: "把素材的明暗映射到該段 colorway 的背景色到主色；照片立刻融進這首歌的配色，最常用、最安全。" },
  "grain-film": { label: "底片顆粒", description: "去飽和、染上配色、加重底片顆粒與輕微晃動閃爍；適合排練照、後台照、回憶感段落。" },
  "blur-glow": { label: "柔焦光暈", description: "失焦的光暈，只留下形狀與顏色；最不搶歌詞，適合歌詞為主的主歌、抒情段。" },
  halftone: { label: "網點", description: "印刷網點（海報、zine 質感），用配色印出；適合龐克、獨立搖滾、有態度的段落。" },
  "mask-lyrics": { label: "避開歌詞", description: "素材滿版，但歌詞出現時歌詞區域的素材會壓暗、退成背景色，歌詞永遠清楚；有歌詞又想放素材時用它。" },
  "slow-drift": { label: "緩慢推移", description: "Ken Burns 式的緩慢推近與平移，整段慢慢移動；適合前奏、橋段、專輯封面當作世界觀。" },
  "beat-cut": { label: "跟拍剪接", description: "每一拍跳到新的構圖／影片片段並在重拍閃一下；只給高能量段落（副歌、drop），MV 片段最有效。" },
};

export const MEDIA_BLEND_INFO: Record<(typeof MEDIA_BLENDS)[number], string> = {
  normal: "一般：素材蓋在場景上（依 opacity）。",
  screen: "濾色：只加亮，黑色消失；適合黑底的 logo、光點、煙火素材。",
  multiply: "色彩增值：只壓暗；讓場景的光從素材的亮部透出。",
  overlay: "覆疊：增加對比並和場景的色彩混合，質感最融合。",
};

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  intro: "前奏",
  verse: "主歌",
  "pre-chorus": "導歌",
  chorus: "副歌",
  bridge: "橋段",
  solo: "獨奏",
  breakdown: "抽離段",
  outro: "尾奏",
  interlude: "間奏",
};
