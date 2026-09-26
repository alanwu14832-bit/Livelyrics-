"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { cx } from "@/components/ui";
import type { ConsoleController } from "@/lib/console/controller";
import { formatCountdown } from "@/lib/console/format";
import { selectTimeDecis, useStageValue } from "@/lib/console/hooks";
import { CUE_KIND_COLORS, CUE_KIND_LABELS } from "@/lib/console/labels";
import { CUE_ACTIVE_WINDOW, sortedCues, upcomingCue } from "@/lib/console/navigation";
import { formatTimeShort } from "@/lib/timeline";
import type { Project } from "@/lib/types";

function CuePanelImpl({ controller, project }: { controller: ConsoleController; project: Project }) {
  const cues = useMemo(() => sortedCues(project.plan), [project.plan]);
  const t = useStageValue(controller.store, selectTimeDecis);
  const upcoming = upcomingCue(cues, t);
  const listRef = useRef<HTMLOListElement>(null);
  const upIndex = upcoming?.index ?? null;

  useEffect(() => {
    if (upIndex == null) return;
    const root = listRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-cue-index="${upIndex}"]`);
    if (!root || !el) return;
    const top = el.offsetTop - 4;
    if (top < root.scrollTop || el.offsetTop + el.offsetHeight > root.scrollTop + root.clientHeight) root.scrollTo({ top, behavior: "smooth" });
  }, [upIndex]);

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel" style={{ gridArea: "cues" }} aria-label="現場提示">
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted">現場提示</h2>
        {upcoming && (
          <span className={cx("font-mono text-[11px] font-semibold tabular", upcoming.inSeconds <= 5 ? "text-warn" : "text-muted")}>
            {formatCountdown(upcoming.inSeconds)}
          </span>
        )}
      </header>
      {cues.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 text-center text-xs text-faint">設計方案沒有現場提示</p>
      ) : (
        <ol ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {cues.map((cue, i) => {
            const isUp = i === upIndex;
            const past = cue.time <= t - CUE_ACTIVE_WINDOW;
            const now = isUp && (upcoming?.inSeconds ?? 1) <= 0;
            return (
              <li key={`${cue.time}-${i}`} data-cue-index={i}>
                <button
                  type="button"
                  onClick={() => controller.seek(Math.max(0, cue.time - 2))}
                  title="跳到提示前 2 秒"
                  className={cx(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                    isUp ? (now ? "bg-warn/15 ring-1 ring-warn/60" : "bg-panel-3 ring-1 ring-line") : "hover:bg-panel-2",
                    past && "opacity-45",
                  )}
                >
                  <span className="mt-1 size-2 shrink-0 rotate-45" style={{ background: CUE_KIND_COLORS[cue.kind] ?? "#888" }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-faint tabular">{formatTimeShort(cue.time)}</span>
                      <span className="text-[10px]" style={{ color: CUE_KIND_COLORS[cue.kind] }}>
                        {CUE_KIND_LABELS[cue.kind] ?? cue.kind}
                      </span>
                      {isUp && <span className={cx("ml-auto font-mono text-[10px] tabular", now ? "text-warn" : "text-muted")}>{formatCountdown(upcoming!.inSeconds)}</span>}
                    </span>
                    <span className={cx("block truncate text-xs", isUp ? "font-semibold text-fg" : "text-fg/85")}>{cue.title}</span>
                    {cue.detail && <span className={cx("block text-[11px] leading-snug text-muted", isUp ? "line-clamp-2" : "line-clamp-1")}>{cue.detail}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export const CuePanel = memo(CuePanelImpl);
