"use client";

// The sync layer's state in the console (phase 5a, 同步): the top bar capsule, the big lock tile of
// the 同步 panel, the per-frame readouts (timecode HH:MM:SS:FF with its rate, BPM, song position)
// and the MIDI activity light. Console chrome only: nothing here reaches the projection window.
//
// Lock states, high contrast and never animated in a loop: green 鎖定 (and 已定位 at an MTC
// locate), yellow on orange 自由運轉 (the timecode stopped, the clock runs on), red 中斷 (fell back to
// manual), grey 等待訊號. Readouts are written per frame through refs (no React re-render).

import { useRef } from "react";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { Tooltip, cx } from "@/components/ui";
import { SOFT_TEXT } from "@/components/ui/Tag";
import { HandTapIcon, LinkBreakIcon, LockSimpleIcon, MetronomeIcon } from "@/components/ui/Icon";
import { formatBpm, formatOffsetSeconds } from "@/lib/console/format";
import { formatTc, rateLabel } from "@/lib/sync/timecode";
import { SYNC_SOURCE_LABELS, type LockState, type SyncEngine, type SyncSnapshot } from "@/lib/sync/engine";
import { formatTime } from "@/lib/timeline";
import { useRafLoop } from "../useRaf";
import { useSyncSnapshot } from "./hooks";

export type LockTone = "green" | "yellow" | "red" | "grey" | "manual";

export interface LockView {
  tone: LockTone;
  /** 鎖定 / 自由運轉 / 中斷 … */
  label: string;
  /** one line of what it means now */
  detail: string;
}

export function lockView(snap: SyncSnapshot): LockView {
  const src = snap.settings.source;
  const name = SYNC_SOURCE_LABELS[src];
  const fw = snap.settings.freewheelSeconds;
  if (src === "manual") return { tone: "manual", label: "手動", detail: "由你用鍵盤、MIDI 控制器或踏板逐句、逐段送出。" };
  if (src === "clock") {
    const map: Record<LockState, LockView> = {
      off: { tone: "manual", label: "手動", detail: "" },
      waiting: { tone: "grey", label: "等待訊號", detail: snap.midi.status === "on" ? "還沒有收到 MIDI clock：請在播放端開啟 MIDI clock 輸出。" : "先啟用 MIDI，再從播放端送出 MIDI clock。" },
      locked: { tone: "green", label: "鎖定", detail: "畫面跟著 MIDI clock 的拍子律動（優先於麥克風與 Tap tempo）。" },
      stopped: { tone: "green", label: "鎖定", detail: "" },
      freewheel: { tone: "yellow", label: "自由運轉", detail: "" },
      lost: { tone: "red", label: "中斷", detail: "超過半秒沒有收到 MIDI clock：拍子改回麥克風或 Tap tempo。" },
    };
    return map[snap.lock];
  }
  const map: Record<LockState, LockView> = {
    off: { tone: "manual", label: "手動", detail: "" },
    waiting: {
      tone: "grey",
      label: "等待訊號",
      detail:
        src === "ltc"
          ? snap.ltc.status === "on"
            ? "還沒有解碼到 LTC：確認時間碼音軌接在這個輸入、音量足夠。"
            : "LTC 音訊輸入還沒開啟。"
          : snap.midi.status === "on"
            ? "還沒有收到 MTC：請在播放端開啟 MIDI Time Code 輸出。"
            : "先啟用 MIDI，再從播放端送出 MTC。",
    },
    locked: { tone: "green", label: "鎖定", detail: `${name} 正在帶動歌詞與畫面；手動操作請先按 X 回到手動。` },
    stopped: { tone: "green", label: "已定位", detail: "播放端停在這個位置（MTC 定位），開始播放後會繼續跟隨。" },
    freewheel: { tone: "yellow", label: "自由運轉", detail: `時間碼暫停了：先用內部時鐘繼續走，${fw} 秒內沒有恢復就切回手動。` },
    lost: { tone: "red", label: "中斷", detail: "時間碼中斷，已切回手動：歌詞停在原本那一句。時間碼恢復後會自動重新鎖定。" },
  };
  return map[snap.lock];
}

const DOT: Record<LockTone, string> = {
  green: "bg-green",
  yellow: "bg-yellow",
  red: "bg-red",
  grey: "bg-label-3",
  manual: "bg-label-3",
};

/** A 10 px state dot (never pulses). */
export function LockDot({ tone, className }: { tone: LockTone; className?: string }) {
  return <span aria-hidden="true" className={cx("inline-block size-2.5 shrink-0 rounded-full", DOT[tone], className)} />;
}

/** The timecode now, HH:MM:SS:FF (per frame; "--:--:--:--" before any lock). */
export function TimecodeReadout({ engine, className }: { engine: SyncEngine; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  useRafLoop(() => {
    const el = ref.current;
    if (!el) return;
    const r = engine.timecode();
    const text = r ? formatTc(r.label, r.rate) : "--:--:--:--";
    if (text !== last.current) {
      last.current = text;
      el.textContent = text;
    }
  });
  return (
    <span ref={ref} className={cx("font-numeric tabular", className)} data-sync-tc="">
      --:--:--:--
    </span>
  );
}

/** The MIDI clock's tempo (per frame), or a word when there is none. */
export function BpmReadout({ engine, className, empty = "沒有 MIDI clock" }: { engine: SyncEngine; className?: string; empty?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  useRafLoop(() => {
    const el = ref.current;
    if (!el) return;
    const b = engine.beat();
    const bpm = b.locked ? formatBpm(b.bpm) : "";
    const text = bpm ? `${bpm} BPM` : empty;
    if (text !== last.current) {
      last.current = text;
      el.textContent = text;
    }
  });
  return (
    <span ref={ref} className={cx("tabular", className)} data-sync-bpm="">
      {empty}
    </span>
  );
}

/** A dot that flashes on every beat of a locked MIDI clock (per frame; steady under reduced motion). */
export function BeatDot({ engine }: { engine: SyncEngine }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useRafLoop(() => {
    const el = ref.current;
    if (!el) return;
    const b = engine.beat();
    const phase = b.locked && b.phase != null ? b.phase : null;
    const v = phase == null ? 0.15 : reduce ? (phase < 0.25 ? 1 : 0.3) : 0.15 + 0.85 * Math.pow(1 - phase, 3);
    el.style.opacity = v.toFixed(3);
  });
  return <span ref={ref} aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full bg-green" style={{ opacity: 0.15 }} data-beat-dot="" />;
}

/** Song time now (from a song controller). */
export function SongPositionReadout({ songTime, className }: { songTime: () => number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  useRafLoop(() => {
    const el = ref.current;
    if (!el) return;
    const text = formatTime(songTime());
    if (text !== last.current) {
      last.current = text;
      el.textContent = text;
    }
  });
  return (
    <span ref={ref} className={cx("font-numeric tabular", className)} data-sync-song="">
      0:00.00
    </span>
  );
}

/** Lights for 150 ms after each note / controller message. */
export function MidiActivity({ engine, label = "MIDI 訊號" }: { engine: SyncEngine; label?: string }) {
  const dot = useRef<HTMLSpanElement>(null);
  useRafLoop(() => {
    const el = dot.current;
    if (!el) return;
    const a = engine.activity();
    const on = !!a && Date.now() - a.at < 150;
    el.dataset.on = on ? "1" : "0";
  });
  return (
    <span className="inline-flex items-center gap-1.5 text-c-footnote text-label-2" title="收到音符或控制訊息時會亮">
      <span ref={dot} aria-hidden="true" data-on="0" className="size-2 rounded-full bg-label-3 transition-none data-[on=1]:bg-green" data-midi-activity="" />
      {label}
    </span>
  );
}

/** The last note / controller message in words (the learn readout). */
export function MidiLastMessage({ engine, className }: { engine: SyncEngine; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  useRafLoop(() => {
    const el = ref.current;
    if (!el) return;
    const a = engine.activity();
    const text = a ? a.text : "還沒有收到任何訊息";
    if (text !== last.current) {
      last.current = text;
      el.textContent = text;
    }
  });
  return (
    <span ref={ref} className={cx("min-w-0 truncate", className)} aria-live="off" data-midi-last="">
      還沒有收到任何訊息
    </span>
  );
}

/** Text on a soft yellow / green fill (the raw hue pulled 15 % towards --label, like SOFT_TEXT). */
const YELLOW_TEXT = "text-[color-mix(in_srgb,var(--yellow)_85%,var(--label))]";
const GREEN_FILL = "bg-[color-mix(in_srgb,var(--green)_18%,transparent)]";
const YELLOW_FILL = "bg-[color-mix(in_srgb,var(--yellow)_18%,transparent)]";

const CAPSULE_TONE: Record<LockTone, string> = {
  green: `${GREEN_FILL} text-label`,
  grey: "bg-fill-3 text-label-2-on-material",
  manual: "bg-fill-3 text-label-2-on-material",
  yellow: `${YELLOW_FILL} ${YELLOW_TEXT}`,
  red: `bg-red-soft ${SOFT_TEXT.red}`,
};

const CAPSULE_ICON: Record<LockTone, string> = {
  green: "text-green",
  grey: "",
  manual: "",
  yellow: "",
  red: "",
};

/**
 * The top bar's sync capsule (console only): the source and its lock state, e.g. 「LTC 鎖定」,
 * 「MTC 自由運轉」, 「時間碼中斷」, 「MIDI clock 128 BPM」. Nothing while the source is 手動.
 */
export function SyncCapsule({ engine, className }: { engine: SyncEngine; className?: string }) {
  const snap = useSyncSnapshot(engine);
  const src = snap.settings.source;
  if (src === "manual") return null;
  const view = lockView(snap);
  const name = SYNC_SOURCE_LABELS[src];
  const Icon = view.tone === "red" ? LinkBreakIcon : src === "clock" ? MetronomeIcon : LockSimpleIcon;
  const tip = `${name}：${view.label}。${view.detail ? `${view.detail} ` : ""}在「同步」調整，按 X 回到手動。`;
  return (
    <Tooltip content={tip} placement="bottom-end">
      <span
        tabIndex={0}
        className={cx("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-[12px] leading-none font-semibold whitespace-nowrap", CAPSULE_TONE[view.tone], className)}
        data-sync-capsule={snap.lock}
        data-sync-source={src}
      >
        <Icon size={12} className={cx("shrink-0", CAPSULE_ICON[view.tone])} />
        {src === "clock" && snap.lock === "locked" ? (
          <span>
            MIDI clock <BpmReadout engine={engine} empty="" />
          </span>
        ) : view.tone === "red" && src !== "clock" ? (
          <span>時間碼中斷</span>
        ) : (
          <span>
            {name} {view.label}
          </span>
        )}
      </span>
    </Tooltip>
  );
}

const TILE_TONE: Record<LockTone, string> = {
  green: `${GREEN_FILL} shadow-[inset_0_0_0_1.5px_var(--green)]`,
  yellow: `${YELLOW_FILL} shadow-[inset_0_0_0_1.5px_var(--yellow)]`,
  red: "bg-red-soft shadow-[inset_0_0_0_1.5px_var(--red)]",
  grey: "bg-fill-3",
  manual: "bg-fill-3",
};

const LABEL_TONE: Record<LockTone, string> = {
  green: "text-label",
  yellow: YELLOW_TEXT,
  red: SOFT_TEXT.red,
  grey: "text-label",
  manual: "text-label",
};

/** The 同步 panel's lock tile: the state in words and colour, and the readouts. */
export function LockTile({
  engine,
  songTime,
  showTimecode,
  offset,
}: {
  engine: SyncEngine;
  /** the song position (a song console) */
  songTime?: () => number;
  showTimecode: boolean;
  /** the lyric offset (TRACK: it applies to the timecode too); null / undefined: not shown */
  offset?: number | null;
}) {
  const snap = useSyncSnapshot(engine);
  const view = lockView(snap);
  const src = snap.settings.source;
  return (
    <div className={cx("flex min-w-0 flex-col gap-2 rounded-md px-3 py-2.5", TILE_TONE[view.tone])} data-lock-tile={snap.lock} role="status" aria-live="polite">
      <div className="flex min-w-0 items-center gap-2">
        {view.tone === "manual" ? <HandTapIcon size={16} className="shrink-0 text-label-2" /> : <LockDot tone={view.tone} />}
        <span className={cx("text-[15px] leading-5 font-semibold", LABEL_TONE[view.tone])} data-lock-label="">
          {view.label}
        </span>
        {src !== "manual" && <span className="text-c-footnote text-label-2">{SYNC_SOURCE_LABELS[src]}</span>}
        {showTimecode && snap.rate != null && (
          <span className="ml-auto text-c-footnote text-label-2 tabular" data-sync-rate="">
            {rateLabel(snap.rate)}
          </span>
        )}
      </div>
      {showTimecode && <TimecodeReadout engine={engine} className="text-[22px] leading-[26px] font-semibold text-label" />}
      {src === "clock" && (
        <div className="flex items-center gap-2">
          <BpmReadout engine={engine} empty="-- BPM" className="text-[22px] leading-[26px] font-semibold text-label" />
          <BeatDot engine={engine} />
        </div>
      )}
      <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 empty:hidden">
        {src !== "clock" && snap.midi.status === "on" && (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-c-footnote text-label-2">拍速</dt>
            <dd className="text-c-body text-label">
              <BpmReadout engine={engine} empty="—" />
            </dd>
          </div>
        )}
        {songTime && showTimecode && (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-c-footnote text-label-2">歌曲位置</dt>
            <dd className="text-c-body text-label">
              <SongPositionReadout songTime={songTime} />
            </dd>
          </div>
        )}
        {showTimecode && offset != null && (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-c-footnote text-label-2">偏移</dt>
            <dd className="text-c-body text-label tabular">{formatOffsetSeconds(offset)}</dd>
          </div>
        )}
      </dl>
      {view.detail && <p className={cx("text-c-footnote", view.tone === "red" ? SOFT_TEXT.red : "text-label-2")}>{view.detail}</p>}
    </div>
  );
}
