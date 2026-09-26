"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";

/** Streaming Markdown that follows the bottom while the user has not scrolled up. */
export function StreamPanel({
  title,
  text,
  live,
  placeholder,
  badge,
  className,
  maxHeight = "32rem",
}: {
  title: ReactNode;
  text: string;
  live: boolean;
  placeholder?: ReactNode;
  badge?: ReactNode;
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
    <section className={cx("flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel", className)}>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          {live && <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />}
          {title}
        </h2>
        {badge}
      </header>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-3"
        style={{ maxHeight }}
        aria-live={live ? "polite" : undefined}
        aria-busy={live}
      >
        {text ? (
          <>
            <Markdown>{text}</Markdown>
            {live && <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent/70 align-middle" />}
          </>
        ) : (
          <div className="py-6 text-sm text-muted">{placeholder}</div>
        )}
      </div>
    </section>
  );
}
