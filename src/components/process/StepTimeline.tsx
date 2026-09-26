"use client";

import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { formatTimeShort } from "@/lib/timeline";
import type { AudioAnalysis } from "@/lib/types";
import { AlertIcon, CheckIcon, SearchIcon, SpinnerIcon } from "@/components/home/icons";
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
  kept: "未執行",
};

function StatusDot({ status }: { status: StepStatus | "warn" }) {
  const base = "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border";
  switch (status) {
    case "done":
      return (
        <span className={cx(base, "border-ok/40 bg-ok/15 text-ok")}>
          <CheckIcon size={14} />
        </span>
      );
    case "skipped":
      return (
        <span className={cx(base, "border-ok/30 bg-panel-2 text-ok/80")}>
          <CheckIcon size={13} />
        </span>
      );
    case "running":
      return (
        <span className={cx(base, "border-accent/60 bg-accent/15 text-accent shadow-[0_0_14px] shadow-accent/40")}>
          <SpinnerIcon size={14} />
        </span>
      );
    case "error":
      return (
        <span className={cx(base, "border-danger/50 bg-danger/15 text-danger")}>
          <AlertIcon size={13} />
        </span>
      );
    case "warn":
      return (
        <span className={cx(base, "border-warn/40 bg-warn/10 text-warn")}>
          <AlertIcon size={13} />
        </span>
      );
    default:
      return <span className={cx(base, "border-line bg-panel-2")}><span className="size-1.5 rounded-full bg-faint" /></span>;
  }
}

function duration(step: StepState): string | null {
  if (step.startedAt == null) return null;
  const end = step.endedAt ?? null;
  if (end == null) return null;
  const s = Math.max(0, (end - step.startedAt) / 1000);
  return s < 1 ? "<1 秒" : s < 60 ? `${Math.round(s)} 秒` : `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`;
}

function Row({ status, title, detail, meta, children, last }: { status: StepStatus | "warn"; title: string; detail?: ReactNode; meta?: string | null; children?: ReactNode; last?: boolean }) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span aria-hidden="true" className={cx("absolute left-[13px] top-7 bottom-0 w-px", status === "done" || status === "skipped" ? "bg-ok/30" : "bg-line")} />}
      <StatusDot status={status} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cx("text-sm font-medium", status === "pending" || status === "kept" ? "text-muted" : "text-fg")}>{title}</p>
          <span className={cx("shrink-0 text-[11px]", status === "error" ? "text-danger" : status === "running" ? "text-accent" : "text-faint")}>
            {status === "warn" ? "注意" : STATUS_TEXT[status]}
            {meta && ` · ${meta}`}
          </span>
        </div>
        {detail && <div className="mt-0.5 text-xs leading-5 text-muted">{detail}</div>}
        {children}
      </div>
    </li>
  );
}

export function StepTimeline({
  analysis,
  steps,
  searches,
  lyricsEmpty,
}: {
  analysis: AudioAnalysis | null;
  steps: Record<ProcessStep, StepState>;
  searches: string[];
  /** the project has no lyrics (a "kept" lyrics step then means "add them later") */
  lyricsEmpty: boolean;
}) {
  const order: ProcessStep[] = ["lyrics", "research", "design"];
  return (
    <ol aria-label="處理步驟" className="relative">
      <Row
        status={analysis ? "done" : "warn"}
        title={STEP_TITLE.analyze}
        detail={
          analysis
            ? `長度 ${formatTimeShort(analysis.duration)}${analysis.bpm > 0 ? ` · ${Math.round(analysis.bpm)} BPM` : ""} · ${analysis.sections.length} 個段落邊界（上傳時已在瀏覽器完成）`
            : "沒有音訊分析資料：畫面不會跟著音樂能量變化"
        }
      />
      {order.map((id, i) => {
        const s = steps[id];
        const detail =
          s.message ?? (s.status === "kept" ? (id === "lyrics" && lyricsEmpty ? "這次不處理歌詞，之後可在歌詞編輯器加入" : "沿用先前的結果") : STEP_HINT[id]);
        return (
          <Row key={id} status={s.status} title={STEP_TITLE[id]} detail={detail} meta={duration(s)} last={i === order.length - 1}>
            {id === "research" && searches.length > 0 && (
              <ul aria-label="網路搜尋" className="mt-2 flex flex-wrap gap-1.5">
                {searches.map((q) => (
                  <li key={q} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-muted" title={q}>
                    <SearchIcon size={10} className="shrink-0 text-faint" />
                    <span className="truncate">{q}</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
        );
      })}
    </ol>
  );
}
