"use client";

// StatusCapsules (UI-AUDIT §3.3 status capsule, UI-18, UI-19): the console top bar's state row
// (黑場, 凍結, 歌詞隱藏, 場景：X, 等待下一句). Keyboard-driven, so a capsule appears in the same frame
// (0 ms) and fades out in 150 ms ease; at most 3 at once, the rest collapse into 「+n」 (its
// tooltip names them).
//
//   <StatusCapsules items={[
//     blackout && { id: "blackout", tone: "blackout", label: "黑場" },
//     waiting && { id: "wait", tone: "orange", icon: HandPalmIcon, label: "等待下一句" },
//   ]} />

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cx } from "./cx";
import type { UiIcon } from "./icon-base";
import { capsuleOverflow, mergePresence, type Presence } from "./interaction";
import { StatusCapsule, type CapsuleTone } from "./Tag";
import { Tooltip } from "./Tooltip";

export interface CapsuleItem {
  id: string;
  tone: CapsuleTone;
  label: ReactNode;
  /** plain-text label for the +n tooltip when `label` is not a string */
  text?: string;
  icon?: UiIcon | ReactNode;
}

export function StatusCapsules({ items, max = 3, className, "aria-label": ariaLabel = "狀態" }: { items: ReadonlyArray<CapsuleItem | false | null | undefined>; max?: number; className?: string; "aria-label"?: string }) {
  const list = useMemo(() => items.filter((i): i is CapsuleItem => !!i), [items]);
  const { visible, overflow } = capsuleOverflow(list, max);
  const key = visible.map((v) => v.id).join("|") + "|" + visible.map((v) => String(v.tone)).join("|");
  const [prevKey, setPrevKey] = useState(key);
  const [rendered, setRendered] = useState<Presence<CapsuleItem>[]>(() => mergePresence([], visible, (c) => c.id));
  if (key !== prevKey) {
    setPrevKey(key);
    setRendered((r) => mergePresence(r, visible, (c) => c.id));
  }
  // keep labels fresh for items that stay
  const byId = new Map(visible.map((v) => [v.id, v]));
  const exitingKey = rendered
    .filter((r) => r.exiting)
    .map((r) => r.key)
    .join(",");
  useEffect(() => {
    if (!exitingKey) return;
    const t = setTimeout(() => setRendered((r) => r.filter((x) => !x.exiting)), 160);
    return () => clearTimeout(t);
  }, [exitingKey]);

  return (
    <div role="group" aria-label={ariaLabel} className={cx("flex min-w-0 items-center gap-1.5", className)}>
      {rendered.map((r) => {
        const item = byId.get(r.key) ?? r.item;
        return (
          <StatusCapsule
            key={r.key}
            tone={item.tone}
            icon={item.icon}
            aria-hidden={r.exiting || undefined}
            data-exiting={r.exiting || undefined}
            className={cx("transition-none", r.exiting && "opacity-0 transition-opacity duration-(--dur-exit) ease-[ease]")}
          >
            {item.label}
          </StatusCapsule>
        );
      })}
      {overflow.length > 0 && (
        <Tooltip content={overflow.map((o) => o.text ?? (typeof o.label === "string" ? o.label : "")).filter(Boolean).join("、")}>
          <span tabIndex={0} className="inline-flex rounded-pill">
            <StatusCapsule tone="neutral" aria-label={`還有 ${overflow.length} 個狀態`}>
              +{overflow.length}
            </StatusCapsule>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
