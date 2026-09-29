"use client";

// 現場提示: the designer's live cues as a list. The upcoming cue is the standby row (40 % tint
// bar); a cue that is happening now turns orange (warning / wait); passed cues recede to label-2.
// The list follows the upcoming cue on a spring (instant under reduced motion).

import { memo, useEffect, useMemo, useRef } from "react";
import { Tooltip, cx } from "@/components/ui";
import type { ConsoleController } from "@/lib/console/controller";
import { formatCountdown } from "@/lib/console/format";
import { selectTimeDecis, useStageValue } from "@/lib/console/hooks";
import { CUE_KIND_LABELS, cueColor } from "@/lib/console/labels";
import { CUE_ACTIVE_WINDOW, sortedCues, upcomingCue } from "@/lib/console/navigation";
import { formatTimeShort } from "@/lib/timeline";
import type { Project } from "@/lib/types";
import { Pane, PaneHeader, useScrollEdge, useSpringScroll } from "./ui";

function CuePanelImpl({ controller, project }: { controller: ConsoleController; project: Project }) {
  const cues = useMemo(() => sortedCues(project.plan), [project.plan]);
  const t = useStageValue(controller.store, selectTimeDecis);
  const upcoming = upcomingCue(cues, t);
  const listRef = useRef<HTMLOListElement>(null);
  const scroller = useSpringScroll(listRef);
  const scrolled = useScrollEdge(listRef, [cues.length === 0]);
  const upIndex = upcoming?.index ?? null;

  useEffect(() => {
    if (upIndex == null) return;
    const root = listRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-cue-index="${upIndex}"]`);
    if (!root || !el) return;
    const top = el.offsetTop - 4;
    if (top < root.scrollTop || el.offsetTop + el.offsetHeight > root.scrollTop + root.clientHeight) scroller.to(top);
  }, [upIndex, scroller]);

  const soon = upcoming != null && upcoming.inSeconds <= 5;

  return (
    <Pane area="cues" label="現場提示" order={4}>
      <PaneHeader
        title="現場提示"
        scrolled={scrolled}
        actions={upcoming && <span className={cx("text-c-footnote font-semibold tabular", soon ? "text-orange-text" : "text-label-2")}>{formatCountdown(upcoming.inSeconds)}</span>}
      />
      {cues.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 pb-6 text-center text-c-body text-label-2">設計方案沒有現場提示</p>
      ) : (
        <ol ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5" onWheel={() => scroller.stop()}>
          {cues.map((cue, i) => {
            const isUp = i === upIndex;
            const past = cue.time <= t - CUE_ACTIVE_WINDOW;
            const now = isUp && (upcoming?.inSeconds ?? 1) <= 0;
            return (
              <li key={`${cue.time}-${i}`} data-cue-index={i}>
                <Tooltip content="跳到提示前 2 秒" placement="top-start">
                  <button
                    type="button"
                    onClick={() => controller.seek(Math.max(0, cue.time - 2))}
                    className={cx(
                      "flex min-h-9 w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left transition-none focus-inset",
                      isUp ? (now ? "bg-orange-soft shadow-[inset_3px_0_0_var(--orange)]" : "row-standby bg-fill-4") : "hover:bg-fill-4 active:bg-fill-3",
                    )}
                  >
                    <span aria-hidden="true" className={cx("mt-[5px] size-2 shrink-0 rotate-45 rounded-[1px]", past && "opacity-40")} style={{ background: cueColor(cue.kind) }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-c-footnote text-label-2">
                        <span className="tabular">{formatTimeShort(cue.time)}</span>
                        <span>{CUE_KIND_LABELS[cue.kind] ?? cue.kind}</span>
                        {isUp && <span className={cx("ml-auto font-semibold tabular", now ? "text-orange-text" : "text-label")}>{formatCountdown(upcoming!.inSeconds)}</span>}
                      </span>
                      <span className={cx("block truncate text-c-body", isUp ? "font-semibold text-label" : past ? "text-label-2" : "text-label")}>{cue.title}</span>
                      {cue.detail && <span className={cx("block text-c-footnote text-label-2", isUp ? "line-clamp-2" : "line-clamp-1")}>{cue.detail}</span>}
                    </span>
                  </button>
                </Tooltip>
              </li>
            );
          })}
          {/* lets the last cues scroll up to the top of the list */}
          <li aria-hidden="true" style={{ height: "60%" }} />
        </ol>
      )}
    </Pane>
  );
}

export const CuePanel = memo(CuePanelImpl);
