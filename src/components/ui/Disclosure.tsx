// Disclosure (UI-AUDIT UI-31, §3.3): native <details> with the Apple › that turns 90° (200 ms
// ease-out); the content fades in and drops 4 px (200 ms in, 150 ms out) through ::details-content.
// `animateHeight` also animates the height (interpolate-size; process page only, never on the
// console). The whole summary row is the hit area (min 32 px). Server-safe.
//
//   <Disclosure summary="設計說明">…</Disclosure>
//   <Disclosure summary="段落理由" defaultOpen animateHeight>…</Disclosure>
//   <Disclosure summary={…} open={open} onToggle={(o) => setOpen(o)} />   controlled


import type { ReactNode } from "react";
import { cx } from "./cx";
import { CaretRightIcon } from "./Icon";

export function Disclosure({
  summary,
  children,
  defaultOpen,
  open,
  onToggle,
  animateHeight = false,
  className,
  summaryClassName,
  contentClassName,
  name,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  animateHeight?: boolean;
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
  /** exclusive accordion group (native details name) */
  name?: string;
}) {
  return (
    <details
      name={name}
      open={open ?? defaultOpen}
      onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}
      className={cx(
        "group/disclosure min-w-0",
        "[&::details-content]:opacity-0 [&::details-content]:-translate-y-1 [&::details-content]:transition-[opacity,translate,content-visibility] [&::details-content]:duration-150 [&::details-content]:ease-out [&::details-content]:transition-discrete",
        "open:[&::details-content]:translate-y-0 open:[&::details-content]:opacity-100 open:[&::details-content]:duration-200",
        "motion-reduce:[&::details-content]:translate-y-0",
        animateHeight &&
          "[interpolate-size:allow-keywords] [&::details-content]:h-0 [&::details-content]:overflow-clip [&::details-content]:transition-[opacity,translate,height,content-visibility] open:[&::details-content]:h-auto motion-reduce:[&::details-content]:transition-[opacity,content-visibility]",
        className,
      )}
    >
      <summary
        className={cx(
          "flex min-h-8 cursor-default list-none items-center gap-1.5 rounded-sm text-[13px] leading-[18px] font-medium text-label select-none focus-inset [&::-webkit-details-marker]:hidden",
          summaryClassName,
        )}
      >
        <CaretRightIcon size={12} className="shrink-0 text-label-2 transition-transform duration-200 ease-out group-open/disclosure:rotate-90 motion-reduce:transition-none" />
        {summary}
      </summary>
      <div className={contentClassName}>{children}</div>
    </details>
  );
}
