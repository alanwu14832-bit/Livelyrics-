"use client";

// 段落列 (phase 2b): one button per plan section (its name, start time and colours) — a click
// jumps there (TRACK seeks to its start; LIVE cues its first line and shows the section) — and the
// two section latches: 保持段落 (H) keeps the section's look on stage while time and cues move on,
// 循環段落 (R) loops it. The section on stage has the tint ring; a held section wears a pin, a
// looped one the loop mark, and the section the playhead is in carries a thin progress line
// (written per frame, no React), so a held chorus stays readable while the band plays on.
// All of it is console chrome: the projection never shows any of these marks.

import { memo, useEffect, useRef } from "react";
import { Kbd, Tooltip, cx } from "@/components/ui";
import { PushPinSimpleIcon, RepeatIcon, type UiIcon } from "@/components/ui/Icon";
import type { ConsoleController } from "@/lib/console/controller";
import { selectSectionIndex, useStageValue } from "@/lib/console/hooks";
import { sectionIndexAt, formatTimeShort } from "@/lib/timeline";
import type { Project } from "@/lib/types";
import { sectionName } from "./Preview";
import { Pane, TINT_ON_SOFT } from "./ui";
import { useRafLoop } from "./useRaf";

/** A 44 px latch beside the strip: off = fill-3, on = tint-soft (the plan is being overridden). */
function StripToggle({
  label,
  name,
  hint,
  hotkey,
  icon: Icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  /** the accessible name (the full 保持段落 / 循環段落) */
  name: string;
  hint: string;
  hotkey: string;
  icon: UiIcon;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={hint} shortcut={hotkey} placement="top-end">
      <button
        type="button"
        aria-label={name}
        aria-pressed={active}
        aria-keyshortcuts={hotkey}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          "press-tile flex h-11 min-w-[92px] items-center gap-2 rounded-sm px-3 text-left disabled:pointer-events-none disabled:opacity-35",
          active ? cx("bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]", TINT_ON_SOFT) : "bg-fill-3 text-label hover:bg-fill-2",
        )}
      >
        <Icon size={16} weight={active ? "fill" : "bold"} className={cx("shrink-0", !active && "text-label-2")} />
        <span className="min-w-0 flex-1 truncate text-c-body font-semibold">{label}</span>
        <Kbd className={cx(active && "bg-tint-soft")}>{hotkey}</Kbd>
      </button>
    </Tooltip>
  );
}

function SectionStripImpl({ controller, project, hold, loop }: { controller: ConsoleController; project: Project; hold: number | null; loop: number | null }) {
  const plan = project.plan;
  const sections = plan?.sections ?? [];
  const current = useStageValue(controller.store, selectSectionIndex);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const lastBar = useRef<{ index: number | null; p: number }>({ index: null, p: -1 });

  // keep the section on stage in view (no animation: it follows keys and cues)
  useEffect(() => {
    const root = scrollRef.current;
    const el = current != null ? root?.querySelector<HTMLElement>(`[data-section-index="${current}"]`) : null;
    if (!root || !el) return;
    if (el.offsetLeft < root.scrollLeft) root.scrollLeft = el.offsetLeft - 4;
    else if (el.offsetLeft + el.offsetWidth > root.scrollLeft + root.clientWidth) root.scrollLeft = el.offsetLeft + el.offsetWidth - root.clientWidth + 4;
  }, [current]);

  // more sections than fit: fade the edge they continue past (set on the element, no re-render)
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const update = () => {
      const left = root.scrollLeft > 1;
      const right = root.scrollLeft + root.clientWidth < root.scrollWidth - 1;
      root.dataset.fade = left && right ? "both" : left ? "left" : right ? "right" : "none";
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(root);
    return () => {
      root.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [sections.length]);

  // the playhead's progress through its section (it can differ from the held one)
  useRafLoop(() => {
    const t = controller.songTime();
    const index = sectionIndexAt(plan, t);
    const s = index != null ? sections[index] : undefined;
    const p = s && s.end > s.start ? Math.min(1, Math.max(0, (t - s.start) / (s.end - s.start))) : 0;
    const last = lastBar.current;
    if (last.index === index && Math.abs(last.p - p) < 0.002) return;
    if (last.index !== index && last.index != null) {
      const prev = bars.current[last.index];
      if (prev) prev.style.opacity = "0";
    }
    const el = index != null ? bars.current[index] : null;
    if (el) {
      el.style.opacity = "1";
      el.style.transform = `scaleX(${p.toFixed(4)})`;
    }
    lastBar.current = { index, p };
  });

  if (sections.length === 0) return null;
  const holdName = hold != null && sections[hold] ? sectionName(sections[hold]).label : null;
  const loopName = loop != null && sections[loop] ? sectionName(sections[loop]).label : null;

  return (
    <Pane label="段落列" order={2} className="shrink-0">
      <div className="flex min-w-0 items-center gap-2 p-2">
        <div
          ref={scrollRef}
          role="group"
          aria-label="段落（點擊跳到該段）"
          className={cx(
            "flex min-w-0 flex-1 gap-1.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "data-[fade=right]:[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)]",
            "data-[fade=left]:[mask-image:linear-gradient(to_left,#000_calc(100%-32px),transparent)]",
            "data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_32px,#000_calc(100%-32px),transparent)]",
          )}
        >
          {sections.map((s, i) => {
            const name = sectionName(s);
            const onStage = i === current;
            const [, primary, accent] = s.colorway;
            return (
              <button
                key={s.id || i}
                type="button"
                data-section-index={i}
                aria-current={onStage ? "true" : undefined}
                aria-label={`${name.label}${name.kind ? `（${name.kind}）` : ""}，${formatTimeShort(s.start)}${hold === i ? "，保持中" : ""}${loop === i ? "，循環中" : ""}`}
                onClick={() => controller.jumpToSection(i)}
                className={cx(
                  "press-tile relative flex h-11 max-w-[152px] min-w-[80px] shrink-0 flex-col justify-center overflow-hidden rounded-sm pr-2.5 pl-4 text-left",
                  onStage ? "bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]" : "bg-fill-3 hover:bg-fill-2",
                )}
              >
                <span
                  aria-hidden="true"
                  className="absolute top-2 bottom-2 left-2 w-[3px] rounded-full"
                  style={{ background: `linear-gradient(${primary ?? "var(--label-3)"}, ${accent ?? primary ?? "var(--label-3)"})` }}
                />
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate text-c-body font-semibold text-label">{name.label}</span>
                  {hold === i && <PushPinSimpleIcon size={12} weight="fill" className={cx("shrink-0", TINT_ON_SOFT)} aria-label="保持中" />}
                  {loop === i && <RepeatIcon size={12} className={cx("shrink-0", TINT_ON_SOFT)} aria-label="循環中" />}
                </span>
                <span className="min-w-0 truncate text-c-footnote text-label-2">
                  <span className="tabular">{formatTimeShort(s.start)}</span>
                  {name.kind ? `・${name.kind}` : ""}
                </span>
                <span
                  ref={(el) => {
                    bars.current[i] = el;
                  }}
                  aria-hidden="true"
                  className="absolute right-2.5 bottom-1 left-4 h-0.5 origin-left rounded-full bg-label-2"
                  style={{ opacity: 0, transform: "scaleX(0)" }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StripToggle
            label={holdName ? "保持中" : "保持"}
            name="保持段落"
            hint={holdName ? `保持段落：「${holdName}」的畫面停在台上；再按一次回到目前時間的段落` : "保持段落：畫面停在這一段（場景、配色、歌詞樣式、素材），歌詞照常跟著時間與提詞"}
            hotkey="H"
            icon={PushPinSimpleIcon}
            active={hold != null}
            onClick={() => controller.toggleHold()}
          />
          <StripToggle
            label={loopName ? "循環中" : "循環"}
            name="循環段落"
            hint={loopName ? `循環段落：「${loopName}」；再按一次或跳到別段就結束` : "循環段落：跟音檔時播到段落結尾回到開頭；手動時最後一句之後接回第一句"}
            hotkey="R"
            icon={RepeatIcon}
            active={loop != null}
            onClick={() => controller.toggleLoop()}
          />
        </div>
      </div>
    </Pane>
  );
}

export const SectionStrip = memo(SectionStripImpl);
