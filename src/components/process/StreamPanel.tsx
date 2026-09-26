"use client";

// A calm streaming panel (UI-AUDIT §3.5 處理頁): a --surface group with 13 / 20 text. Each new
// paragraph fades in from a 4 px blur (3.4.1 item 6); the caret is a 2 px tint bar that blinks in
// two steps (static with reduced motion). Web searches fold into one label-2 line. It follows the
// bottom only while the reader has not scrolled up; the caller batches the SSE deltas.

import { useEffect, useRef, type ReactNode } from "react";
import { Spinner, cx } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";

const PARAGRAPH_IN =
  "[&>*]:transition-[opacity,filter] [&>*]:duration-300 [&>*]:ease-out [&>*]:starting:opacity-0 [&>*]:starting:blur-[4px] motion-reduce:[&>*]:starting:blur-none";
const CARET =
  "[&>:last-child]:after:ml-0.5 [&>:last-child]:after:inline-block [&>:last-child]:after:h-[1.05em] [&>:last-child]:after:w-0.5 [&>:last-child]:after:translate-y-[0.15em] [&>:last-child]:after:bg-tint [&>:last-child]:after:content-[''] [&>:last-child]:after:animate-caret motion-reduce:[&>:last-child]:after:animate-none";

export function StreamPanel({
  title,
  text,
  live,
  placeholder,
  badge,
  searches,
  className,
  maxHeight = "32rem",
}: {
  title: ReactNode;
  text: string;
  live: boolean;
  placeholder?: ReactNode;
  badge?: ReactNode;
  /** web searches made so far, shown as one line */
  searches?: readonly string[];
  className?: string;
  maxHeight?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <section className={cx("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface", className)}>
      <header className="flex min-h-12 shrink-0 items-center gap-2 px-5 pt-1">
        <h2 className="text-[15px] leading-5 font-semibold text-label">{title}</h2>
        {live && <Spinner size={14} label="撰寫中" labelClassName="text-[13px] leading-5" className="ml-1" />}
        {badge && <span className="ml-auto shrink-0 text-[13px] leading-5 text-label-2">{badge}</span>}
      </header>
      {searches && searches.length > 0 && (
        <p className="-mt-1 truncate px-5 pb-1 text-[13px] leading-5 text-label-2" title={searches.join("、")}>
          搜尋：{searches.join("、")}
        </p>
      )}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-4"
        style={{ maxHeight }}
        aria-live={live ? "polite" : undefined}
        aria-busy={live}
      >
        {text ? (
          <Markdown className={cx("text-[13px]! leading-5! [&_h1]:text-[15px]! [&_h2]:text-[13px]! [&_h2]:leading-5!", PARAGRAPH_IN, live && CARET)}>{text}</Markdown>
        ) : (
          <p className="py-4 text-[13px] leading-5 text-label-2">{placeholder}</p>
        )}
      </div>
    </section>
  );
}
