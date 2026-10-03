// Operator cue notes derived from a plan's sections (used by the offline designer and
// to top up a Claude plan that came back with too few cues). Every cue is gated on evidence:
// a 爆點 needs a real energy rise, a 合唱 needs more than one chorus and lyrics to sing, a
// 中段檢查 needs a song long enough to drift, and nothing mentions a singer when the song has no
// lyrics. The wording names the section's actual transition (「淡入」 when LED 安全模式 converts a
// flash) and never asks a calm song to flash.

import type { CueNote, LyricLine, SectionDesign } from "@/lib/types";
import type { MotionEnergy } from "./lexicon/genres";
import { LYRIC_STYLES, SCENES, TRANSITIONS } from "./catalog";

export const MAX_CUES = 12;
export const MIN_CUES = 3;

/** A 爆點 cue needs at least this much energy rise into the section. */
export const DROP_RISE = 0.25;
/** A 合唱 cue needs at least this many choruses (one chorus is not a sing-along habit yet). */
export const SINGALONG_CHORUSES = 2;
/** 開場 / 中段檢查 / 結束 cues only make sense on a song at least this long (seconds). */
export const CHECK_MIN_DURATION = 60;
export const END_MIN_DURATION = 20;

export interface CueContext {
  /** the song has sung lines (default: `lines` has any) */
  hasLyrics?: boolean;
  /** the genre's transition energy; soft never flashes */
  motion?: MotionEnergy;
  /** a calm song (a ballad's 平靜內斂, folk's 「不要閃爍」): no flash, no 「推到 1.2」 */
  calm?: boolean;
  /** LED 安全模式 converts flash / bloom into a fade on the wall (on by default) */
  ledSafe?: boolean;
}

const PRIORITY: Record<CueNote["kind"], number> = {
  warning: 0,
  drop: 1,
  singalong: 2,
  quiet: 3,
  transition: 4,
  highlight: 5,
};

const round2 = (t: number) => Math.round(t * 100) / 100;

/** The transition as the wall will show it: 「淡入」 when LED 安全模式 turns a flash or bloom into a fade. */
export function transitionWording(t: SectionDesign["transitionIn"], ledSafe = true): string {
  const name = TRANSITIONS[t].split("：")[0];
  if (ledSafe && (t === "flash" || t === "bloom")) return `淡入（LED 安全模式把${name}改成淡入）`;
  return name;
}

/** Suggested cues for a plan, sorted by time, at most MAX_CUES. */
export function suggestCues(sections: readonly SectionDesign[], duration: number, lines: readonly LyricLine[] = [], ctx: CueContext = {}): CueNote[] {
  const cues: CueNote[] = [];
  const hasLyrics = ctx.hasLyrics ?? lines.some((l) => typeof l.text === "string" && l.text.trim());
  const calm = ctx.calm || ctx.motion === "soft";
  const ledSafe = ctx.ledSafe ?? true;
  const chorusCount = sections.filter((s) => s.kind === "chorus").length;
  const firstLine = hasLyrics ? lines.find((l) => l.start != null) : undefined;
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
    if (prev && rise >= DROP_RISE) {
      const how = transitionWording(s.transitionIn, ledSafe);
      cues.push({
        time: round2(Math.max(0, s.start - 0.2)),
        title: calm ? `${s.label}亮起` : `${s.label}爆點`,
        detail: calm
          ? `${how}進「${scene}」，讓亮度慢慢爬上來就好，不推強度、不閃。`
          : `${how}進「${scene}」（能量 ${prev.energy.toFixed(2)} → ${s.energy.toFixed(2)}），衝上來時可把強度推到 1.2。`,
        kind: "drop",
      });
    }
    if (hasLyrics && s.kind === "chorus" && s.lyricStyle !== "hidden" && chorusCount >= SINGALONG_CHORUSES) {
      const how =
        s.lyricStyle === "impact" && !calm
          ? "口號以巨字呈現，帶全場一起喊"
          : s.lyricStyle === "karaoke" || s.lyricStyle === "subtitle"
            ? `歌詞以「${LYRIC_STYLES[s.lyricStyle].label}」呈現`
            : "副歌的每一句都放大成畫面的主角";
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
        detail: hasLyrics ? "畫面降到低亮度，把焦點還給樂手；若主唱即興延長，改用手動 cue。" : "畫面降到低亮度，把焦點還給樂手；若樂團即興延長，改用手動 cue。",
        kind: "quiet",
      });
    } else if (prev && (s.kind === "solo" || s.kind === "interlude") && s.lyricStyle === "hidden") {
      cues.push({
        time: round2(s.start),
        title: `${s.label}：畫面主導`,
        detail: `${hasLyrics ? "歌詞隱藏，" : ""}讓「${scene}」隨鼓點脈動；需要時可用數字鍵切換場景。`,
        kind: "highlight",
      });
    }
  });
  if (duration >= END_MIN_DURATION) {
    cues.push({
      time: round2(Math.max(0, duration - 1)),
      title: "結束",
      detail: "最後一拍後按 B 全黑，等待下一首。",
      kind: "warning",
    });
  }
  return capCues(cues);
}

/** The generic cues a short plan is topped up with: only on a song long enough for them to mean anything. */
export function genericCues(duration: number): CueNote[] {
  if (duration < CHECK_MIN_DURATION) return [];
  return [
    { time: 0, title: "開場", detail: "確認輸出視窗已全螢幕、歌詞層狀態正確；樂團未就位前可先全黑（B）。", kind: "transition" },
    { time: round2(duration / 2), title: "中段檢查", detail: "確認畫面與樂團同步；若樂團改變段落順序，切到現場模式手動 cue。", kind: "highlight" },
  ];
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
