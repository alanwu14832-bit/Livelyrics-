// ProgressBar (UI-AUDIT §3.3 ProgressBar): determinate progress. 4 px track, radius 2, fill-3;
// the tint fill moves with a transform (240 ms linear), never width. Label 13 px label-2 above,
// percentage tabular on the right. For unknown progress use <Spinner> instead. Server-safe.
//
//   <ProgressBar value={0.42} label="分析中…" showValue />
//   <ProgressBar value={p} aria-label="上傳進度" />
//
// The fill slides in from the left (translateX) rather than scaleX, so its leading end keeps
// its round cap; both are transform-only.

import type { Ref } from "react";
import { cx } from "./cx";

export function ProgressBar({
  value,
  label,
  showValue = false,
  className,
  fillRef,
  "aria-label": ariaLabel,
}: {
  /** 0..1 */
  value: number;
  label?: string;
  showValue?: boolean;
  className?: string;
  /** for per-frame updates that bypass React: set style.transform = `translateX(${(p - 1) * 100}%)` */
  fillRef?: Ref<HTMLDivElement>;
  "aria-label"?: string;
}) {
  const p = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const pct = Math.round(p * 100);
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-3 text-[13px] leading-5 text-label-2">
          <span className="min-w-0 truncate">{label}</span>
          {showValue && <span className="tabular shrink-0">{pct}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={ariaLabel ?? label}
        className="relative h-1 overflow-hidden rounded-[2px] bg-fill-3"
      >
        <div
          ref={fillRef}
          className="absolute inset-0 rounded-[2px] bg-tint transition-transform duration-[240ms] ease-linear motion-reduce:transition-none"
          style={{ transform: `translateX(${(p - 1) * 100}%)` }}
        />
      </div>
    </div>
  );
}
