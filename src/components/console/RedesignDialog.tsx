"use client";

// Re-design sheet (UI-AUDIT UI-21, §3.3 Sheet, 640 wide): one sentence to the stage designer, the
// streamed progress, then the new plan is applied to the console and the projection. A native
// modal <dialog> (top layer, focus trap, Esc, focus returns); the scrim is never blurred (the
// preview keeps rendering underneath). B still blacks out from inside it, outside the text field.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Banner, Button, Sheet, TextArea, cx } from "@/components/ui";
import { CheckCircleIcon, MagnifyingGlassIcon, SparkleIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import type { ConsoleController, RedesignState } from "@/lib/console/controller";
import { Group, GroupTitle } from "./ui";

const SUGGESTIONS = [
  "副歌更熱血",
  "主歌更安靜、多留白",
  "換成冷色調",
  "歌詞更大、更好讀",
  "歌詞少一點，讓畫面說話",
  "加強主視覺符號的存在感",
  "開場更有儀式感",
  "最後一次副歌推到最高潮",
];

export function RedesignDialog({
  open,
  controller,
  redesign,
  hasPlan,
  hasResearch,
  onBlackout,
  onClose,
}: {
  open: boolean;
  controller: ConsoleController;
  redesign: RedesignState;
  hasPlan: boolean;
  hasResearch: boolean;
  /** B from inside the sheet (outside its text field) */
  onBlackout: () => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState(redesign.running ? redesign.instruction : "");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const running = redesign.running;
  const started = running || redesign.log.length > 0 || redesign.error != null;
  const finished = !running && redesign.finishedAt != null && redesign.error == null && redesign.log.some((l) => l.kind === "done");

  // a run started elsewhere (or before a reload) shows its own instruction
  const [prevRunning, setPrevRunning] = useState(running);
  if (running !== prevRunning) {
    setPrevRunning(running);
    if (running && redesign.instruction) setInstruction(redesign.instruction);
  }

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [redesign.log.length, redesign.text]);

  const addSuggestion = (s: string) => {
    setInstruction((prev) => {
      const trimmed = prev.trim();
      if (trimmed.includes(s)) return prev;
      return trimmed ? `${trimmed}、${s}` : s;
    });
    textRef.current?.focus();
  };

  const start = () => {
    if (running) return;
    void controller.redesign(instruction);
  };

  // the dialog is modal and keeps console hotkeys out, except the blackout key
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.code === "KeyB" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing && tag !== "TEXTAREA" && tag !== "INPUT") {
      e.preventDefault();
      onBlackout();
    }
  };

  const title = hasPlan ? "重新設計" : "產生設計";
  const action = running ? (
    <Button variant="plain" onClick={() => controller.cancelRedesign()}>
      停止等待
    </Button>
  ) : (
    <Button variant="filled" icon={SparkleIcon} onClick={start}>
      {started ? "再設計一次" : hasPlan ? "開始" : "產生"}
    </Button>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      width={640}
      cancelLabel={running ? "背景執行" : finished ? "完成" : "取消"}
      action={action}
      initialFocus={running ? undefined : textRef}
      onKeyDown={onKeyDown}
    >
      <p className="text-c-body text-label-2">
        {hasResearch
          ? "用一句話告訴舞台視覺設計師想怎麼改。研究結果會保留，只重做設計方案：主視覺、逐段場景與歌詞呈現、現場提示。"
          : "這首歌還沒有研究資料：會先研究樂團與歌曲，再產生設計方案（主視覺、逐段場景與歌詞呈現、現場提示）。"}
      </p>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-c-footnote font-semibold text-label-2">設計指示（可留空，讓設計師自由發揮）</span>
        <TextArea
          ref={textRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              start();
            }
          }}
          disabled={running}
          rows={3}
          maxLength={4000}
          placeholder="例如：副歌要更熱血、主歌多留白，整體換成冷色調"
          className="resize-none"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="建議">
        {SUGGESTIONS.map((s) => {
          const on = instruction.includes(s);
          return (
            <button
              key={s}
              type="button"
              disabled={running}
              aria-pressed={on}
              onClick={() => addSuggestion(s)}
              className={cx(
                "press h-7 rounded-pill px-3 text-c-footnote font-medium disabled:opacity-35",
                on ? "bg-tint-soft text-[color-mix(in_srgb,var(--tint-text-on-soft)_85%,var(--label))]" : "bg-fill-3 text-label hover:bg-fill-2",
              )}
            >
              {s}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-c-footnote text-label-2">{running ? "可以先關閉這個視窗，完成後會自動套用。" : "⌘ 或 Ctrl + Enter 開始。"}</p>

      {started && (
        <section aria-labelledby="redesign-progress" className="mt-4">
          <GroupTitle
            id="redesign-progress"
            actions={
              finished ? (
                <span className="flex items-center gap-1 text-c-footnote text-label">
                  <CheckCircleIcon size={14} weight="fill" className="text-green" />
                  已套用到控制台與投影
                </span>
              ) : running ? (
                <span className="text-c-footnote text-label-2">設計中…</span>
              ) : undefined
            }
          >
            進度
          </GroupTitle>
          <Group className="mt-1">
            <div ref={logRef} className="max-h-64 min-h-16 overflow-y-auto px-3 py-2">
              <ul className="flex flex-col gap-1.5" aria-live="polite">
                {redesign.log.map((l) => (
                  <li key={l.id} className="flex items-start gap-2 text-c-body">
                    <span className="mt-px flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                      {l.kind === "search" ? (
                        <MagnifyingGlassIcon size={14} className="text-label-2" />
                      ) : l.kind === "error" || l.status === "error" ? (
                        <WarningCircleIcon size={14} weight="fill" className="text-red" />
                      ) : l.kind === "done" || l.status === "done" ? (
                        <CheckCircleIcon size={14} weight="fill" className="text-green" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-label-3" />
                      )}
                    </span>
                    <span className={cx(l.kind === "error" ? "text-red-text" : l.kind === "step" ? "text-label" : "text-label-2")}>{l.kind === "search" ? `搜尋：${l.message}` : l.message}</span>
                  </li>
                ))}
              </ul>
              {redesign.text && (
                <div className="mt-2 pt-1 border-t-hairline">
                  <Markdown className="text-label-2! [&_h2]:text-c-body [&_h3]:text-c-body">{redesign.text.slice(-2400)}</Markdown>
                </div>
              )}
            </div>
          </Group>
          {redesign.error && <Banner tone="error" className="mt-2" title="重新設計失敗" description={redesign.error} />}
        </section>
      )}
    </Sheet>
  );
}
