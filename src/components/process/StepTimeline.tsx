"use client";

// The processing steps as an iOS inset grouped list (UI-AUDIT §3.5 處理頁, UI-30): each row has a
// status accessory (running: the activity indicator; done: a green check that draws itself in
// 200 ms when the step has just finished while you watched; error: a red WarningCircle; waiting: a
// hollow label-3 circle), a 15 / 500 title, a 13 px label-2 detail and the status or duration on
// the right. Nothing glows and nothing loops except the spinner.

import { useState, type ReactNode } from "react";
import { Spinner, cx } from "@/components/ui";
import { WarningCircleIcon, WarningIcon } from "@/components/ui/Icon";
import { formatTimeShort } from "@/lib/timeline";
import type { AudioAnalysis } from "@/lib/types";
import type { StepState, StepStatus } from "./pipeline-state";
import type { ProcessStep } from "./steps";

const STEP_TITLE: Record<ProcessStep | "analyze", string> = {
  analyze: "分析音訊",
  lyrics: "取得歌詞",
  research: "研究樂團與歌曲",
  design: "設計主視覺",
};

const STEP_HINT: Record<ProcessStep, string> = {
  lyrics: "貼上的歌詞、既有同步歌詞或 LRCLIB",
  research: "樂團視覺史、歌曲意象、情緒弧線",
  design: "色票、符號、字體、每段畫面與歌詞呈現",
};

const STATUS_TEXT: Record<StepStatus, string> = {
  pending: "等待中",
  running: "進行中",
  done: "完成",
  skipped: "略過",
  error: "失敗",
  kept: "沿用",
};

const ORDER: ProcessStep[] = ["lyrics", "research", "design"];

type RowStatus = StepStatus | "warn";

/** Green check in a filled circle; `draw` plays the one-shot stroke (scale .9 -> 1, no bounce). */
function DoneIcon({ draw, muted = false }: { draw: boolean; muted?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0 overflow-visible">
      <circle
        cx="10"
        cy="10"
        r="10"
        className={cx(
          "origin-center [transform-box:fill-box]",
          muted ? "fill-label-3" : "fill-green",
          draw && "transition-transform duration-200 ease-out starting:scale-90 motion-reduce:transition-none",
        )}
      />
      <path
        d="M5.8 10.4l2.9 2.9 5.6-6"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className={cx("[stroke-dasharray:1] [stroke-dashoffset:0]", draw && "transition-[stroke-dashoffset] delay-50 duration-200 ease-out starting:[stroke-dashoffset:1] motion-reduce:transition-none")}
      />
    </svg>
  );
}

function StatusIcon({ status, draw, hollow }: { status: RowStatus; draw: boolean; hollow?: boolean }) {
  if (hollow) return <span aria-hidden="true" className="size-5 rounded-full border-[1.5px] border-label-3" />;
  switch (status) {
    case "running":
      return <Spinner size={20} />;
    case "done":
    case "skipped":
      return <DoneIcon draw={draw} />;
    case "kept":
      return <DoneIcon draw={false} muted />;
    case "error":
      return <WarningCircleIcon size={20} weight="fill" className="text-red" />;
    case "warn":
      return <WarningIcon size={20} weight="fill" className="text-orange" />;
    default:
      return <span aria-hidden="true" className="size-5 rounded-full border-[1.5px] border-label-3" />;
  }
}

function duration(step: StepState): string | null {
  if (step.startedAt == null || step.endedAt == null) return null;
  const s = Math.max(0, (step.endedAt - step.startedAt) / 1000);
  return s < 1 ? "不到 1 秒" : s < 60 ? `${Math.round(s)} 秒` : `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`;
}

function Row({
  status,
  draw,
  hollow,
  title,
  detail,
  meta,
  statusText,
  children,
}: {
  status: RowStatus;
  draw: boolean;
  hollow?: boolean;
  title: string;
  detail?: ReactNode;
  meta?: string | null;
  statusText?: string;
  children?: ReactNode;
}) {
  const quiet = status === "pending" || status === "kept";
  // the leading accessory already says running / done / waiting; words only where they add something
  const right =
    statusText ??
    (status === "warn" ? "注意" : status === "done" || status === "running" || status === "pending" ? (meta ?? null) : STATUS_TEXT[status as StepStatus]);
  return (
    <li
      className={cx(
        "relative flex min-w-0 gap-3 px-4 py-3",
        "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-12 after:h-(--hairline) after:bg-separator last:after:hidden",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <StatusIcon status={status} draw={draw} hollow={hollow} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <p className={cx("min-w-0 text-[15px] leading-5 font-medium", quiet ? "text-label-2" : "text-label")}>{title}</p>
          {right ? (
            <span className={cx("shrink-0 text-[13px] leading-5 tabular", status === "error" ? "text-red-text" : "text-label-2")}>{right}</span>
          ) : (
            <span className="sr-only">{STATUS_TEXT[status as StepStatus]}</span>
          )}
        </div>
        {detail && <div className="mt-0.5 text-[13px] leading-[18px] break-words text-label-2">{detail}</div>}
        {children}
      </div>
    </li>
  );
}

export function StepTimeline({
  analysis,
  steps,
  lyricsEmpty,
  footer,
}: {
  analysis: AudioAnalysis | null;
  steps: Record<ProcessStep, StepState>;
  /** kept for older callers; the searches now show in the research stream panel */
  searches?: string[];
  /** the project has no lyrics (a "kept" lyrics step then means "add them later") */
  lyricsEmpty: boolean;
  footer?: ReactNode;
}) {
  // steps that finished while this page watched them get the one-shot check animation
  const [prev, setPrev] = useState(steps);
  const [fresh, setFresh] = useState<ReadonlySet<ProcessStep>>(() => new Set());
  if (steps !== prev) {
    const next = new Set(fresh);
    for (const id of ORDER) {
      if (prev[id].status === "running" && steps[id].status === "done") next.add(id);
      if (steps[id].status === "running") next.delete(id);
    }
    setPrev(steps);
    setFresh(next);
  }

  return (
    <section aria-labelledby="steps-title" className="min-w-0">
      <h2 id="steps-title" className="mb-1.5 px-4 text-[13px] leading-5 text-label-2">
        處理步驟
      </h2>
      <ol className="overflow-hidden rounded-lg bg-surface">
        <Row
          status={analysis ? "done" : "warn"}
          draw={false}
          title={STEP_TITLE.analyze}
          detail={
            analysis
              ? `${formatTimeShort(analysis.duration)}${analysis.bpm > 0 ? `，${Math.round(analysis.bpm)} BPM` : ""}，${analysis.sections.length} 個段落邊界。上傳時已在瀏覽器完成。`
              : "沒有音訊分析資料：畫面不會跟著音樂能量變化。"
          }
        />
        {ORDER.map((id) => {
          const s = steps[id];
          const detail =
            s.message ?? (s.status === "kept" ? (id === "lyrics" && lyricsEmpty ? "這次不處理歌詞，之後可在歌詞編輯器加入" : "沿用先前的結果") : STEP_HINT[id]);
          const noLyrics = s.status === "kept" && id === "lyrics" && lyricsEmpty;
          return (
            <Row
              key={id}
              status={s.status}
              hollow={noLyrics}
              statusText={noLyrics ? "未處理" : undefined}
              draw={fresh.has(id)}
              title={STEP_TITLE[id]}
              detail={detail}
              meta={duration(s)}
            />
          );
        })}
      </ol>
      {footer && <p className="mt-1.5 px-4 text-[12px] leading-4 text-label-2">{footer}</p>}
    </section>
  );
}
