// Spinner (UI-AUDIT §3.3 ProgressBar and activity): the iOS activity indicator. Phosphor's
// 8-spoke Spinner, stepped round in 8 steps (0.8 s), with a conic mask that fades the spokes
// behind the leading one, like UIActivityIndicatorView. The only infinite animation allowed in
// the UI; it keeps turning under reduced motion (non-vestibular, as on iOS). Server-safe.
//
//   <Spinner />                          16 px, label-2
//   <Spinner size={20} label="處理中…" /> announces politely (role="status"), label visible
//   <Spinner label="載入中" hideLabel />   screen-reader-only label
//   <Spinner inheritColor />              inside a button (takes the text colour)

import type { CSSProperties } from "react";
import { cx } from "./cx";
import { SpinnerIcon } from "./kit-icons";

// 8 sectors of 45°, centred on the spokes: the head is opaque, the trail fades clockwise-behind
const MASK = `conic-gradient(from -22.5deg, rgb(0 0 0) 0deg 45deg, rgb(0 0 0 / 0.28) 45deg 90deg, rgb(0 0 0 / 0.36) 90deg 135deg, rgb(0 0 0 / 0.46) 135deg 180deg, rgb(0 0 0 / 0.56) 180deg 225deg, rgb(0 0 0 / 0.68) 225deg 270deg, rgb(0 0 0 / 0.8) 270deg 315deg, rgb(0 0 0 / 0.9) 315deg 360deg)`;
const maskStyle: CSSProperties = { WebkitMaskImage: MASK, maskImage: MASK };

export function Spinner({
  size = 16,
  label,
  hideLabel = false,
  inheritColor = false,
  className,
  labelClassName,
}: {
  size?: 14 | 16 | 20 | number;
  /** status text next to the spinner (announced with aria-live polite) */
  label?: string;
  /** keep the label for screen readers only */
  hideLabel?: boolean;
  /** use the surrounding text colour (inside buttons) instead of label-2 */
  inheritColor?: boolean;
  className?: string;
  labelClassName?: string;
}) {
  const icon = <SpinnerIcon size={size} weight={size <= 17 ? "bold" : "regular"} className="shrink-0 animate-spinner" style={maskStyle} />;
  const tone = inheritColor ? undefined : "text-label-2";
  if (!label) return <span className={cx("inline-flex shrink-0", tone, className)}>{icon}</span>;
  return (
    <span role="status" aria-live="polite" className={cx("inline-flex items-center gap-1.5", tone, className)}>
      {icon}
      <span className={cx(hideLabel && "sr-only", labelClassName)}>{label}</span>
    </span>
  );
}
