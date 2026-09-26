// Operator cue notes derived from a plan's sections (used by the offline designer and
// to top up a Claude plan that came back with too few cues).

import type { CueNote, LyricLine, SectionDesign } from "@/lib/types";
import { LYRIC_STYLES, SCENES, TRANSITIONS } from "./catalog";

export const MAX_CUES = 12;
export const MIN_CUES = 3;

const PRIORITY: Record<CueNote["kind"], number> = {
  warning: 0,
  drop: 1,
  singalong: 2,
  quiet: 3,
  transition: 4,
  highlight: 5,
};

const round2 = (t: number) => Math.round(t * 100) / 100;

function transitionName(t: SectionDesign["transitionIn"]): string {
  return TRANSITIONS[t].split("：")[0];
}

/** Suggested cues for a plan, sorted by time, at most MAX_CUES. */
export function suggestCues(sections: readonly SectionDesign[], duration: number, lines: readonly LyricLine[] = []): CueNote[] {
  const cues: CueNote[] = [];
  const firstLine = lines.find((l) => l.start != null);
  if (firstLine?.start != null && firstLine.start > 1.5) {
    cues.push({
      time: round2(Math.max(0, firstLine.start - 0.5)),
      title: "第一句歌詞",
      detail: "主唱開口前確認歌詞層已開啟（L）；若樂團拉長前奏，切到現場模式手動 cue 第一句。",
      kind: "transition",
    });
  }
  sections.forEach((s, i) => {
    const prev = sections[i - 1];
    const scene = SCENES[s.scene].label;
    const rise = prev ? s.energy - prev.energy : 0;
    if (prev && rise >= 0.25) {
      cues.push({
        time: round2(Math.max(0, s.start - 0.2)),
        title: `${s.label}爆點`,
        detail: `${transitionName(s.transitionIn)}進「${scene}」，能量衝上來時可把強度推到 1.2。`,
        kind: "drop",
      });
    }
    if (s.kind === "chorus" && s.lyricStyle !== "hidden") {
      const how =
        s.lyricStyle === "impact"
          ? "口號以巨字呈現，帶全場一起喊"
          : s.lyricStyle === "karaoke"
            ? "整行提前出現、填色跟唱"
            : `歌詞以「${LYRIC_STYLES[s.lyricStyle].label}」呈現`;
      cues.push({
        time: round2(s.start),
        title: `${s.label}合唱`,
        detail: `${how}；主唱把麥克風交給觀眾時，保持歌詞在畫面上。`,
        kind: "singalong",
      });
    } else if (prev && i < sections.length - 1 && s.energy <= 0.32 && rise <= -0.2) {
      cues.push({
        time: round2(s.start),
        title: `${s.label}收`,
        detail: "畫面降到低亮度，把焦點還給樂手；若主唱即興延長，改用手動 cue。",
        kind: "quiet",
      });
    } else if (prev && (s.kind === "solo" || s.kind === "interlude") && s.lyricStyle === "hidden") {
      cues.push({
        time: round2(s.start),
        title: `${s.label}：畫面主導`,
        detail: `歌詞隱藏，讓「${scene}」隨鼓點脈動；需要時可用數字鍵切換場景。`,
        kind: "highlight",
      });
    }
  });
  if (duration > 5) {
    cues.push({
      time: round2(Math.max(0, duration - 1)),
      title: "結束",
      detail: "最後一拍後按 B 全黑，等待下一首。",
      kind: "warning",
    });
  }
  return capCues(cues);
}

/** Dedupe (same moment + kind), keep the MAX_CUES most important, sort by time. */
export function capCues(cues: readonly CueNote[], max = MAX_CUES): CueNote[] {
  const unique: CueNote[] = [];
  for (const c of cues) {
    if (unique.some((u) => Math.abs(u.time - c.time) < 0.5 && (u.kind === c.kind || u.title === c.title))) continue;
    unique.push(c);
  }
  const kept =
    unique.length <= max
      ? unique
      : [...unique].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.time - b.time).slice(0, max);
  return [...kept].sort((a, b) => a.time - b.time);
}
