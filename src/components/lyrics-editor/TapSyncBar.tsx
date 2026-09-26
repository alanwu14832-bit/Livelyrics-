"use client";

import { useId } from "react";
import { Button, Kbd, cx } from "@/components/ui";
import { CheckIcon, TapIcon } from "@/components/home/icons";
import type { EditorLine } from "./editor-model";
import { MAX_TAP_LATENCY, type TapSession } from "./tap-sync";

export function TapSyncBar({
  session,
  lines,
  latency,
  onLatency,
  onStart,
  onMark,
  onUndo,
  onSkip,
  onExit,
  disabled,
}: {
  session: TapSession | null;
  lines: EditorLine[];
  latency: number;
  onLatency: (v: number) => void;
  onStart: () => void;
  onMark: () => void;
  onUndo: () => void;
  onSkip: () => void;
  onExit: () => void;
  disabled?: boolean;
}) {
  const latencyId = useId();
  if (!session) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-5 py-2.5">
        <Button variant="primary" size="sm" onClick={onStart} disabled={disabled || lines.length === 0}>
          <TapIcon size={14} />
          開始對拍
        </Button>
        <p className="text-xs text-muted">
          從頭播放，每句開唱時按 <Kbd>Space</Kbd> 標記、<Kbd>Backspace</Kbd> 退回上一句、<Kbd>Esc</Kbd> 結束。也可以按每行的 <TapIcon size={11} className="inline" /> 從該行開始。
        </p>
        <label htmlFor={latencyId} className="ml-auto flex items-center gap-2 text-xs text-muted" title="人按鍵通常比聽到的晚一點；歌詞寧可早一點出現">
          反應時間補償
          <input
            id={latencyId}
            type="range"
            min={0}
            max={MAX_TAP_LATENCY}
            step={0.01}
            value={latency}
            onChange={(e) => onLatency(Number(e.target.value))}
            className="w-24 accent-[var(--color-accent)]"
          />
          <span className="w-12 font-mono tabular text-fg">{latency.toFixed(2)} 秒</span>
        </label>
      </div>
    );
  }

  const done = session.pointer >= lines.length;
  const current = lines[session.pointer];
  const next = lines[session.pointer + 1];
  const markedCount = session.marked.length;
  return (
    <div
      role="region"
      aria-label="對拍模式"
      className="relative flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-accent/40 bg-gradient-to-r from-accent/[0.14] via-panel to-panel px-5 py-3"
    >
      <span className="flex items-center gap-2 text-xs font-semibold text-accent">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
        </span>
        對拍中
      </span>
      <div className="min-w-0 flex-1" aria-live="polite">
        {done ? (
          <p className="flex items-center gap-2 text-base font-semibold text-ok">
            <CheckIcon size={16} /> 全部標記完成（{markedCount} 句）。按 Esc 結束，或 Backspace 修正最後一句。
          </p>
        ) : (
          <>
            <p className="truncate text-lg font-semibold text-fg">
              <span className="mr-2 font-mono text-xs font-normal text-faint">
                {session.pointer + 1}/{lines.length}
              </span>
              {current?.text || "（空白行）"}
            </p>
            <p className="truncate text-xs text-muted">下一句：{next?.text || "—"}</p>
          </>
        )}
      </div>
      {/* mouse clicks must not move focus onto these buttons, or Space would press them a second time */}
      <div className="flex flex-wrap items-center gap-1.5" onMouseDown={(e) => e.preventDefault()}>
        <Button size="sm" variant="primary" onClick={onMark} disabled={done} className={cx("min-w-24")}>
          <Kbd className="border-white/30 bg-white/15 text-white">Space</Kbd> 標記
        </Button>
        <Button size="sm" onClick={onSkip} disabled={done}>
          <Kbd>↓</Kbd> 略過
        </Button>
        <Button size="sm" onClick={onUndo} disabled={markedCount === 0 && session.pointer <= session.from}>
          <Kbd>⌫</Kbd> 退回
        </Button>
        <Button size="sm" variant="ghost" onClick={onExit}>
          <Kbd>Esc</Kbd> 結束
        </Button>
      </div>
    </div>
  );
}
