// Display names (繁中) for the plan vocabularies, shown in the design summary. Scene names come from
// the one source (src/lib/stage/scenes/labels.ts) the console timeline and the designer use too.

import { SCENE_LABELS } from "@/lib/stage/scenes/labels";
import type { CueNote, LyricPlacement, LyricsSource, LyricStyleId, SceneId, SectionKind } from "@/lib/types";

export const SCENE_LABEL: Record<SceneId, string> = SCENE_LABELS;

export const LYRIC_STYLE_LABEL: Record<LyricStyleId, string> = {
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

export const PLACEMENT_LABEL: Record<LyricPlacement, string> = {
  center: "置中",
  "lower-third": "下三分之一",
  "upper-third": "上三分之一",
  left: "靠左",
  right: "靠右",
  "vertical-right": "右側直排",
  "vertical-left": "左側直排",
};

export const SECTION_KIND_LABEL: Record<SectionKind, string> = {
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

export const CUE_KIND_LABEL: Record<CueNote["kind"], string> = {
  drop: "爆點",
  singalong: "大合唱",
  quiet: "安靜",
  transition: "轉場",
  highlight: "亮點",
  warning: "注意",
};

export const LYRICS_SOURCE_LABEL: Record<LyricsSource, string> = {
  "lrclib-synced": "LRCLIB 同步歌詞",
  "lrclib-plain": "LRCLIB 純文字",
  user: "使用者提供",
  embedded: "音檔內嵌",
  none: "無歌詞",
};
