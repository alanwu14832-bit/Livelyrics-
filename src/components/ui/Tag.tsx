// Tag, StatusCapsule and the legacy Badge (UI-AUDIT §3.3 Badge / Tag / status capsule). Server-safe.
//
// Tag: metadata (section kind, scene name, 「同步歌詞」). 20 px high, 6 px sides, radius 6, 12 / 500,
// fill-3 with secondary text (--label-2-on-material: plain label-2 on fill-3 is 4.0:1 in light).
//   <Tag>副歌</Tag>   <Tag tone="tint">同步歌詞</Tag>
//
// StatusCapsule: console top-bar state only. 24 px, 10 px sides, capsule, 12 / 600. The blackout
// capsule is the only solid one; others are the colour's soft fill with its text colour.
//   <StatusCapsule tone="blackout">黑場</StatusCapsule>
//   <StatusCapsule tone="orange" icon={HandPalmIcon}>等待下一句</StatusCapsule>
//   <StatusCapsule tone="tint">場景：粒子星空</StatusCapsule>
// Show them with <StatusCapsules> (client, ./StatusCapsules) for the 3-at-most rule, 0 ms
// entrance and 150 ms fade-out.
//
// Badge (legacy API, tone neutral | accent | ok | warn | danger) renders as a Tag. "ok" is a
// neutral tag with a green dot (green is never small text).

import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import type { UiIcon } from "./Icon";
import { renderIcon } from "./render-icon";

export type TagTone = "neutral" | "tint" | "orange" | "red";

const TAG_TONE: Record<TagTone, string> = {
  // label-2 on fill-3 is only 4.0:1 in light; the on-material secondary label is 6.4:1 (and 7:1+ in dark)
  neutral: "bg-fill-3 text-label-2-on-material",
  tint: "bg-tint-soft text-tint-text-on-soft",
  orange: "bg-orange-soft text-orange-text",
  red: "bg-red-soft text-red-text",
};

export function Tag({ tone = "neutral", icon, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: TagTone; icon?: UiIcon | ReactNode }) {
  return (
    <span
      {...props}
      className={cx("inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-xs px-1.5 text-[12px] leading-none font-medium whitespace-nowrap", TAG_TONE[tone], className)}
    >
      {renderIcon(icon, 12)}
      {children}
    </span>
  );
}

export type CapsuleTone = "blackout" | "red" | "orange" | "tint" | "neutral";

const CAPSULE_TONE: Record<CapsuleTone, string> = {
  blackout: "bg-red-fill text-white",
  red: "bg-red-soft text-red-text",
  orange: "bg-orange-soft text-orange-text",
  tint: "bg-tint-soft text-tint-text-on-soft",
  neutral: "bg-fill-3 text-label-2-on-material",
};

export function StatusCapsule({ tone = "neutral", icon, dot = false, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: CapsuleTone; icon?: UiIcon | ReactNode; dot?: boolean }) {
  return (
    <span
      {...props}
      className={cx("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-[12px] leading-none font-semibold whitespace-nowrap", CAPSULE_TONE[tone], className)}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {renderIcon(icon, 12)}
      {children}
    </span>
  );
}

/** @deprecated use Tag (metadata) or StatusCapsule (console state); kept so unmigrated pages compile */
export function Badge({ tone = "neutral", className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "ok" | "warn" | "danger" }) {
  const mapped: TagTone = tone === "accent" ? "tint" : tone === "warn" ? "orange" : tone === "danger" ? "red" : "neutral";
  return (
    <Tag {...props} tone={mapped} className={className}>
      {tone === "ok" && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-green" />}
      {children}
    </Tag>
  );
}
