"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Kbd, Popover, Slider, cx } from "@/components/ui";
import { CheckCircleIcon, DotsThreeIcon, HandTapIcon, QuestionIcon } from "@/components/ui/Icon";
import { SOFT_TEXT } from "@/components/ui/Tag";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import type { EditorLine } from "./editor-model";
import { DEFAULT_TAP_LATENCY, MAX_TAP_LATENCY, type TapSession } from "./tap-sync";

// Tap-sync (UI-AUDIT §3.5 歌詞編輯器, UI-36): a focused mode like recording in Voice Memos. Idle:
// one tinted 「開始對拍」 button with the reaction-time compensation tucked into a ⋯ popover.
// Tapping: a full-width red band (static red dot, one line of instructions, ? for the details)
// and a big target card with the line to mark, the next line and a 56 px 「標記」 button that
// presses like a key on every Space. Band and card materialize in 200 ms and fade out in 150 ms.

function LatencySlider({ latency, onLatency }: { latency: number; onLatency: (v: number) => void }) {
  return (
    <Slider
      label="反應時間補償"
      value={latency}
      min={0}
      max={MAX_TAP_LATENCY}
      step={0.01}
      onChange={onLatency}
      resetValue={DEFAULT_TAP_LATENCY}
      format={(v) => `${v.toFixed(2)} 秒`}
      hint="人按鍵通常比聽到的晚一點，標記的時間會提早這麼多；歌詞寧可早一點出現。"
    />
  );
}

/** Idle controls in the transport card. */
export function TapSyncStart({ onStart, latency, onLatency, disabled }: { onStart: () => void; latency: number; onLatency: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="tinted" icon={HandTapIcon} onClick={onStart} disabled={disabled}>
        開始對拍
      </Button>
      <Popover
        label="對拍設定"
        placement="bottom-end"
        width={300}
        trigger={(p) => <Button {...p} variant="quiet" size="icon" aria-label="對拍設定" icon={<DotsThreeIcon size={20} />} />}
      >
        <div className="p-3">
          <LatencySlider latency={latency} onLatency={onLatency} />
        </div>
      </Popover>
    </div>
  );
}

function TapHelp({ latency, onLatency }: { latency: number; onLatency: (v: number) => void }) {
  const keys: [string, string][] = [
    ["Space", "標記這一句的開始"],
    ["Backspace", "退回上一句重新標記"],
    ["ArrowDown", "略過這一句"],
    ["ArrowLeft", "倒退 3 秒"],
    ["ArrowRight", "快轉 3 秒"],
    ["Escape", "結束對拍"],
  ];
  return (
    <Popover
      label="對拍說明"
      placement="bottom-end"
      width={320}
      trigger={(p) => <Button {...p} variant="quiet" size="icon" aria-label="對拍說明" icon={<QuestionIcon size={20} />} />}
    >
      <div className="space-y-3 p-3">
        <p className="text-[13px] leading-5 text-label-2">從選的那一句開始播放（會先倒回一點前奏）。每一句一開唱就按 Space，按晚了就用 Backspace 退回重按。</p>
        <ul className="space-y-1.5">
          {keys.map(([k, label]) => (
            <li key={k} className="flex items-center justify-between gap-3 text-[13px] leading-5 text-label">
              {label}
              <Kbd keys={k} />
            </li>
          ))}
        </ul>
        <LatencySlider latency={latency} onLatency={onLatency} />
      </div>
    </Popover>
  );
}

export interface TapFocusProps {
  session: TapSession | null;
  lines: EditorLine[];
  latency: number;
  onLatency: (v: number) => void;
  onMark: () => void;
  onUndo: () => void;
  onSkip: () => void;
  onExit: () => void;
}

/** Keeps the last session on screen for the 150 ms fade-out after tap-sync ends. */
function usePresence<T>(value: T | null, exitMs: number): { shown: T | null; leaving: boolean } {
  const [state, setState] = useState<{ shown: T | null; leaving: boolean }>({ shown: value, leaving: false });
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setState(value != null ? { shown: value, leaving: false } : { shown: state.shown, leaving: state.shown != null });
  }
  useEffect(() => {
    if (!state.leaving) return;
    const t = setTimeout(() => setState({ shown: null, leaving: false }), exitMs);
    return () => clearTimeout(t);
  }, [state.leaving, exitMs]);
  return state;
}

// enter: 200 ms ease-out from 4 px above; exit: 150 ms fade (data-leaving)
const PRESENCE =
  "transition-[opacity,translate] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 data-leaving:pointer-events-none data-leaving:opacity-0 data-leaving:duration-150 motion-reduce:starting:translate-y-0";

/** The red band under the header while tapping. */
export function TapSyncBand(props: TapFocusProps) {
  const { shown, leaving } = usePresence(props.session, 150);
  if (!shown) return null;
  return (
    <div
      data-leaving={leaving || undefined}
      className={cx("flex min-h-10 shrink-0 items-center gap-3 bg-red-soft px-(--page-gutter) py-1", PRESENCE)}
      role="status"
    >
      <span className={cx("flex items-center gap-2 text-[13px] leading-5 font-semibold", SOFT_TEXT.red)}>
        <span aria-hidden="true" className="size-2 rounded-full bg-red" />
        對拍中
      </span>
      <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-label">播放後，在每句開唱時按 Space</p>
      <TapHelp latency={props.latency} onLatency={props.onLatency} />
    </div>
  );
}

/** The big target card: the line to mark now, the next one, and the mark button. */
export function TapSyncCard({ session: live, lines, onMark, onUndo, onSkip, onExit }: TapFocusProps) {
  const { shown: session, leaving } = usePresence(live, 150);
  const reduce = useReducedMotion();
  const markRef = useRef<HTMLButtonElement>(null);
  const marked = session?.marked.length ?? 0;
  const lastMarked = useRef(marked);

  // every mark (Space or click) presses the big button like a key: down, then spring back
  useEffect(() => {
    const grew = marked > lastMarked.current;
    lastMarked.current = marked;
    if (!grew || reduce) return;
    markRef.current?.animate([{ transform: "scale(1)" }, { transform: "scale(0.95)", offset: 0.22 }, { transform: "scale(1)" }], {
      duration: 280,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
  }, [marked, reduce]);

  if (!session) return null;
  const done = session.pointer >= lines.length;
  const current = lines[session.pointer];
  const next = lines[session.pointer + 1];
  const canUndo = marked > 0 || session.pointer > session.from;

  return (
    <section
      aria-label="對拍模式"
      data-leaving={leaving || undefined}
      className={cx("mx-(--page-gutter) mt-3 flex shrink-0 flex-wrap items-center gap-x-8 gap-y-4 rounded-2xl bg-surface px-6 py-5", PRESENCE)}
    >
      <div className="min-w-0 flex-1 basis-80" aria-live="polite">
        {done ? (
          <div className="flex items-center gap-3">
            <CheckCircleIcon size={28} weight="fill" className="shrink-0 text-green" />
            <div>
              <p className="text-title-2 text-label">全部標記完成</p>
              <p className="text-[15px] leading-[22px] text-label-2">已標記 {marked} 句。按結束離開，或用退回修正最後一句。</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-5 text-label-2">
              第 <span className="t-latin tabular">{session.pointer + 1}</span> 句，共 <span className="t-latin tabular">{lines.length}</span> 句
            </p>
            <p className="mt-0.5 truncate text-title-2 text-label">{current?.text || "（空白行）"}</p>
            <p className="mt-1 truncate text-[15px] leading-[22px] text-label-2">{next ? `下一句：${next.text || "（空白行）"}` : "這是最後一句"}</p>
          </>
        )}
      </div>
      {/* mouse clicks must not move focus onto these buttons, or Space would press them a second time */}
      <div className="flex flex-wrap items-center gap-2" onMouseDown={(e) => e.preventDefault()}>
        {done ? (
          <Button variant="filled" size="lg" onClick={onExit}>
            完成
          </Button>
        ) : (
          <button
            ref={markRef}
            type="button"
            onClick={onMark}
            className="press inline-flex h-14 min-w-44 items-center justify-center gap-2.5 rounded-xl bg-tint-fill px-6 text-[17px] leading-6 font-semibold text-on-tint hover:bg-tint-fill-hover"
          >
            標記
            <Kbd className="bg-white/20 text-white shadow-none">Space</Kbd>
          </button>
        )}
        <div className="flex items-center">
          <Button variant="plain" onClick={onUndo} disabled={!canUndo}>
            退回 <Kbd keys="Backspace" />
          </Button>
          {!done && (
            <Button variant="plain" onClick={onSkip}>
              略過 <Kbd keys="ArrowDown" />
            </Button>
          )}
          {!done && (
            <Button variant="plain" onClick={onExit}>
              結束 <Kbd keys="Escape" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
