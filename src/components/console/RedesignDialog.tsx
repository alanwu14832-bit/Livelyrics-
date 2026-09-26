"use client";

import { SpinnerIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import type { ConsoleController, RedesignState } from "@/lib/console/controller";
import { IconCheck, IconClose, IconSearch, IconSparkles, IconWarning } from "./icons";

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
  controller,
  redesign,
  hasPlan,
  hasResearch,
  onClose,
}: {
  controller: ConsoleController;
  redesign: RedesignState;
  hasPlan: boolean;
  hasResearch: boolean;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState(redesign.running ? redesign.instruction : "");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const running = redesign.running;
  const started = running || redesign.log.length > 0 || redesign.error != null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!running) textRef.current?.focus();
    return () => previous?.focus?.();
    // focus once when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const finished = !running && redesign.finishedAt != null && redesign.error == null && redesign.log.some((l) => l.kind === "done");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onKeyDown={(e) => {
        // the dialog is modal: keep console hotkeys out while it is open…
        e.stopPropagation();
        if (e.key === "Escape") onClose();
        // …except the blackout key, which must work from anywhere outside the text field
        const tag = (e.target as HTMLElement).tagName;
        if (e.code === "KeyB" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && tag !== "TEXTAREA" && tag !== "INPUT") {
          e.preventDefault();
          controller.toggleBlackout();
        }
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="redesign-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id="redesign-title" className="flex items-center gap-2 text-base font-semibold text-fg">
              <IconSparkles className="text-accent" />
              {hasPlan ? "重新設計" : "產生設計"}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-faint">
              {hasResearch
                ? "用一句話告訴舞台視覺設計師想怎麼改，會保留研究結果、只重做設計方案（主視覺、逐段場景與歌詞呈現、現場提示）。"
                : "這首歌還沒有研究資料：會先研究樂團與歌曲，再產生設計方案（主視覺、逐段場景與歌詞呈現、現場提示）。"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-panel-3 hover:text-fg" aria-label="關閉">
            <IconClose />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">設計指示（可留空，讓設計師自由發揮）</span>
            <textarea
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
              className="resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-fg placeholder:text-faint focus-visible:border-accent focus-visible:outline-none disabled:opacity-60"
            />
          </label>
          <div className="flex flex-wrap gap-1.5" aria-label="建議">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={running}
                onClick={() => addSuggestion(s)}
                className={cx(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40",
                  instruction.includes(s) ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-muted hover:border-faint hover:text-fg",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {started && (
            <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-line bg-bg/60 p-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-muted">進度</span>
                {running && (
                  <span className="flex items-center gap-1 text-muted">
                    <SpinnerIcon size={12} weight="bold" className="animate-spinner" aria-hidden="true" />
                    設計中…
                  </span>
                )}
                {finished && <span className="flex items-center gap-1 text-ok"><IconCheck size={12} />已套用到控制台與投影</span>}
              </div>
              <div ref={logRef} className="max-h-64 min-h-16 overflow-y-auto text-xs">
                <ul className="flex flex-col gap-1">
                  {redesign.log.map((l) => (
                    <li key={l.id} className="flex items-start gap-1.5">
                      {l.kind === "search" ? (
                        <IconSearch size={12} className="mt-0.5 shrink-0 text-accent-2" />
                      ) : l.kind === "error" || l.status === "error" ? (
                        <IconWarning size={12} className="mt-0.5 shrink-0 text-danger" />
                      ) : l.kind === "done" || l.status === "done" ? (
                        <IconCheck size={12} className="mt-0.5 shrink-0 text-ok" />
                      ) : (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-faint" />
                      )}
                      <span className={cx(l.kind === "error" ? "text-danger" : l.kind === "step" ? "text-fg" : "text-muted")}>
                        {l.kind === "search" ? `搜尋：${l.message}` : l.message}
                      </span>
                    </li>
                  ))}
                </ul>
                {redesign.text && (
                  <div className="mt-2 border-t border-line pt-1">
                    <Markdown className="text-[11px] leading-relaxed text-muted [&_h2]:text-xs [&_h3]:text-xs">{redesign.text.slice(-2400)}</Markdown>
                  </div>
                )}
              </div>
              {redesign.error && <p className="rounded-md bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{redesign.error}</p>}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <p className="text-[11px] text-faint">{running ? "可以先關閉這個視窗，完成後會自動套用。" : "⌘／Ctrl + Enter 開始"}</p>
          <div className="flex items-center gap-2">
            {running ? (
              <>
                <Button variant="ghost" onClick={() => controller.cancelRedesign()}>
                  停止等待
                </Button>
                <Button variant="secondary" onClick={onClose}>
                  背景執行
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={onClose}>
                  {finished ? "完成" : "取消"}
                </Button>
                <Button variant="primary" onClick={start}>
                  <IconSparkles />
                  {started ? "再設計一次" : hasPlan ? "開始重新設計" : "產生設計"}
                </Button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
