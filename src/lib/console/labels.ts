// Operator-facing Traditional Chinese names for the DesignPlan vocabularies. Scene names come from
// the one source (src/lib/stage/scenes/labels.ts) the stage lab and the designer's catalogue use too.

import type { CueNote, LyricPlacement, LyricStyleId, MediaTreatment, SceneId, SectionDesign, SectionKind } from "@/lib/types";

export { SCENE_LABELS } from "@/lib/stage/scenes/labels";

export const SCENE_HINTS: Record<SceneId, string> = {
  nebula: "流動的雲霧與色煙，柔和、夢幻",
  particles: "漂浮粒子／星空，隨拍點脈動",
  waves: "層疊光帶／示波器線條，律動但不搶戲",
  grid: "復古透視網格與地平線光暈，有速度感",
  tunnel: "向觀眾衝來的放射隧道，留給最高潮",
  rain: "垂直落下的光絲，憂鬱或洗滌感",
  bokeh: "柔焦光球，溫暖、城市夜色",
  shards: "碎片／彩繪玻璃，張力與衝突",
  ink: "高對比墨流，東方、文學、神秘",
  motif: "主視覺符號平鋪／環繞／脈動",
  gradient: "平靜漸層，讓歌詞成為主角",
  blackout: "刻意的黑暗，把焦點還給舞台",
};

export const LYRIC_STYLE_LABELS: Record<LyricStyleId, string> = {
  karaoke: "卡拉 OK 填色",
  "line-fade": "整行淡入",
  "word-pop": "逐字彈出",
  typewriter: "打字機",
  stack: "詩句堆疊",
  vertical: "直排",
  impact: "巨字衝擊",
  subtitle: "字幕",
  hidden: "不顯示",
};

export const LYRIC_STYLE_HINTS: Record<LyricStyleId, string> = {
  karaoke: "整行先出現，填色逐字掃過；適合大合唱副歌",
  "line-fade": "整行淡入淡出；最穩定好讀的預設",
  "word-pop": "詞語逐一彈出；有能量與節奏感",
  typewriter: "字元依序出現；敘事與懸念感",
  stack: "一行行往上堆疊，舊行變暗；抒情段落",
  vertical: "中文直排，文學與海報感",
  impact: "巨大粗體、一次幾個字；hook 與口號",
  subtitle: "小而安靜的下方字幕；畫面為主",
  hidden: "不顯示歌詞；讓畫面與燈光當主角",
};

export const PLACEMENT_LABELS: Record<LyricPlacement, string> = {
  center: "置中",
  "lower-third": "下方三分之一",
  "upper-third": "上方三分之一",
  left: "左側",
  right: "右側",
  "vertical-right": "右側直排",
  "vertical-left": "左側直排",
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

export const TRANSITION_LABELS: Record<SectionDesign["transitionIn"], string> = {
  cut: "硬切",
  fade: "淡入",
  flash: "閃白",
  wipe: "擦除",
  bloom: "光暈綻放",
};

export const CUE_KIND_LABELS: Record<CueNote["kind"], string> = {
  drop: "爆發",
  singalong: "大合唱",
  quiet: "安靜",
  transition: "轉場",
  highlight: "重點",
  warning: "注意",
};

/**
 * Cue marker colours by urgency, as design tokens (never the song palette, never red: red means
 * blackout / on-air / error): orange = act now, yellow = a moment to catch, label-2 = calm.
 * Non-text marks only (diamonds on the timeline and in the cue list); the kind name stays label-2 text.
 */
export const CUE_KIND_TOKENS: Record<CueNote["kind"], "--orange" | "--yellow" | "--label-2"> = {
  drop: "--orange",
  warning: "--orange",
  singalong: "--yellow",
  highlight: "--yellow",
  quiet: "--label-2",
  transition: "--label-2",
};

/** CSS colour for a cue kind's marker. */
export function cueColor(kind: CueNote["kind"]): string {
  return `var(${CUE_KIND_TOKENS[kind] ?? "--label-2"})`;
}

export const LYRICS_SOURCE_LABELS: Record<string, string> = {
  "lrclib-synced": "LRCLIB 同步歌詞",
  "lrclib-plain": "LRCLIB 純文字",
  user: "使用者提供",
  embedded: "音檔內嵌",
  none: "無歌詞",
};

export const MEDIA_TREATMENT_LABELS: Record<MediaTreatment, string> = {
  full: "原樣",
  duotone: "雙色調",
  "grain-film": "底片顆粒",
  "blur-glow": "柔焦光暈",
  halftone: "網點",
  "mask-lyrics": "避開歌詞",
  "slow-drift": "緩慢推移",
  "beat-cut": "跟拍剪接",
};

export const MEDIA_TREATMENT_HINTS: Record<MediaTreatment, string> = {
  full: "素材原樣呈現",
  duotone: "明暗映射到這段的背景色與主色",
  "grain-film": "去飽和、染色、底片顆粒與輕微晃動",
  "blur-glow": "失焦光暈，最不搶歌詞",
  halftone: "海報般的印刷網點，用這段的配色",
  "mask-lyrics": "歌詞出現時，歌詞區的素材退成背景色",
  "slow-drift": "整段緩慢推近與平移",
  "beat-cut": "每一拍換構圖或影片片段，重拍閃一下",
};
