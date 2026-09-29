// Keyboard feedback for the console (UI-AUDIT UI-18, UI-19, §3.5): what the HUD says after a
// hotkey and which status capsules the top bar shows. Both are console chrome only: nothing here
// is ever sent to the projection window.

import type { CapsuleItem, HudContent } from "@/components/ui";
import {
  ArrowCounterClockwiseIcon,
  EyeSlashIcon,
  FilmSlateIcon,
  HandPalmIcon,
  ListNumbersIcon,
  MetronomeIcon,
  MoonIcon,
  ProjectorScreenIcon,
  PushPinSimpleIcon,
  RecordIcon,
  RepeatIcon,
  SnowflakeIcon,
  SpeakerSlashIcon,
  SubtitlesIcon,
  SubtitlesSlashIcon,
  TimerIcon,
  WaveformIcon,
} from "@/components/ui/Icon";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { formatBpm, formatOffsetSeconds } from "@/lib/console/format";
import type { HotkeyAction } from "@/lib/console/hotkeys";
import { LYRIC_STYLE_LABELS, SCENE_LABELS, SECTION_KIND_LABELS } from "@/lib/console/labels";
import { sceneBank } from "@/lib/console/plan-edit";
import type { StageOverrides } from "@/lib/stage/protocol";
import type { Project, SectionDesign } from "@/lib/types";

/** A section's name for the HUD and capsules (「副歌 2」, or its kind when it has no label). */
export function sectionTitle(section: Pick<SectionDesign, "label" | "kind"> | null | undefined): string {
  if (!section) return "";
  return section.label || SECTION_KIND_LABELS[section.kind] || section.kind;
}

/**
 * HUD content for a hotkey that was just handled (read the new state from the controller), or
 * null for keys that need no HUD (transport and selection keys move visible things already).
 */
export function hudForAction(action: HotkeyAction, controller: ConsoleController): HudContent | null {
  const ov = controller.getOverrides();
  const snap = controller.getSnapshot();
  switch (action.type) {
    case "blackout":
      return { icon: MoonIcon, label: "黑場", value: ov.blackout ? "開" : "關", tone: ov.blackout ? "red" : "default" };
    case "lyrics":
      return { icon: ov.lyricsVisible ? SubtitlesIcon : SubtitlesSlashIcon, label: "歌詞", value: ov.lyricsVisible ? "顯示" : "隱藏" };
    case "freeze":
      return { icon: SnowflakeIcon, label: "凍結", value: ov.freeze ? "開" : "關" };
    case "scene": {
      const scene = sceneBank(snap.project?.plan ?? null)[action.slot - 1];
      return { icon: FilmSlateIcon, label: `場景 ${action.slot}`, value: scene ? SCENE_LABELS[scene] : "沒有這一格" };
    }
    case "followPlan":
      return { icon: ArrowCounterClockwiseIcon, label: "回到設計方案" };
    case "offset":
      return { icon: TimerIcon, label: "偏移", value: formatOffsetSeconds(snap.offset) };
    case "tap": {
      const bpm = formatBpm(snap.tap.bpm);
      return { icon: MetronomeIcon, label: "拍速", value: bpm ? `${bpm} BPM` : "再點幾下" };
    }
    case "mode":
      return snap.mode === "live" ? { icon: RecordIcon, label: "LIVE 模式", tone: "red" } : { icon: WaveformIcon, label: "TRACK 模式" };
    case "openOutput":
      return { icon: ProjectorScreenIcon, label: snap.output.connected ? "已聚焦投影視窗" : "已開啟投影視窗" };
    case "hold": {
      const section = snap.sectionHold != null ? snap.project?.plan?.sections[snap.sectionHold] : null;
      return { icon: PushPinSimpleIcon, label: "保持段落", value: section ? sectionTitle(section) : "關" };
    }
    case "loop": {
      const section = snap.sectionLoop != null ? snap.project?.plan?.sections[snap.sectionLoop] : null;
      return { icon: RepeatIcon, label: "循環段落", value: section ? sectionTitle(section) : "關" };
    }
    case "section": {
      const index = controller.store.get().sectionIndex;
      const section = index != null ? snap.project?.plan?.sections[index] : null;
      return section ? { icon: ListNumbersIcon, label: `段落 ${index! + 1}`, value: sectionTitle(section) } : null;
    }
    default:
      return null;
  }
}

/** What the capsules need to know besides the overrides (a look on air has no transport). */
export type CapsuleSource = Pick<ConsoleSnapshot, "mode" | "liveHeld" | "muted" | "offset"> & {
  sectionHold?: number | null;
  sectionLoop?: number | null;
  project?: Project | null;
};

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;

/**
 * The top bar's state capsules, most important first (the bar shows three, then 「+n」): blackout
 * is the only solid one; waiting, lyrics hidden and freeze are orange; overrides of the plan are
 * tint; the rest are neutral reminders of settings that change what the room sees or hears.
 */
export function capsuleItems(ov: StageOverrides, snap: CapsuleSource): CapsuleItem[] {
  const live = snap.mode === "live";
  const sections = snap.project?.plan?.sections ?? [];
  const hold = snap.sectionHold != null ? sections[snap.sectionHold] : undefined;
  const loop = snap.sectionLoop != null ? sections[snap.sectionLoop] : undefined;
  const items: Array<CapsuleItem | false> = [
    ov.blackout && { id: "blackout", tone: "blackout", icon: MoonIcon, label: "黑場" },
    live && snap.liveHeld && { id: "held", tone: "orange", icon: HandPalmIcon, label: "等待下一句" },
    // console chrome only: the projection never shows that a section is held or looping
    !!hold && { id: "hold", tone: "tint", icon: PushPinSimpleIcon, label: `保持中：${sectionTitle(hold)}` },
    !!loop && { id: "loop", tone: "tint", icon: RepeatIcon, label: `循環：${sectionTitle(loop)}` },
    !ov.lyricsVisible && { id: "lyrics", tone: "orange", icon: EyeSlashIcon, label: "歌詞隱藏" },
    ov.freeze && { id: "freeze", tone: "orange", icon: SnowflakeIcon, label: "凍結" },
    ov.scene != null && { id: "scene", tone: "tint", label: `場景：${SCENE_LABELS[ov.scene] ?? ov.scene}` },
    ov.lyricStyle != null && { id: "style", tone: "tint", label: `歌詞：${LYRIC_STYLE_LABELS[ov.lyricStyle] ?? ov.lyricStyle}` },
    ov.testPattern && { id: "test", tone: "neutral", label: "測試圖" },
    !near(ov.intensity, 1) && { id: "intensity", tone: "neutral", label: `強度 ${Math.round(ov.intensity * 100)}%` },
    !near(ov.lyricScale, 1) && { id: "scale", tone: "neutral", label: `字級 ×${ov.lyricScale.toFixed(2)}` },
    !live && snap.muted && { id: "muted", tone: "neutral", icon: SpeakerSlashIcon, label: "靜音" },
    !live && snap.offset !== 0 && { id: "offset", tone: "neutral", label: `偏移 ${formatOffsetSeconds(snap.offset)}` },
  ];
  return items.filter((i): i is CapsuleItem => !!i);
}
