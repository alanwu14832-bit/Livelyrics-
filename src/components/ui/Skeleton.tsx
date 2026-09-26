// Skeleton (UI-AUDIT §3.3 Skeleton): static fill-4 blocks shaped like the final layout (cards 14,
// text lines 12 or 16 high with radius 6). They appear only after 300 ms (the local API is usually
// faster) and never pulse. Wrap a loading region in <SkeletonGroup> for aria-busy + a label.
// Server-safe.
//
//   <SkeletonGroup label="載入作品庫">
//     <Skeleton className="aspect-[16/10] rounded-xl" />
//     <SkeletonText lines={2} />
//   </SkeletonGroup>

import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cx("skeleton", className)} style={style} />;
}

/** Text lines: 12 px high (captions) or 16 px (body), the last one shorter. */
export function SkeletonText({ lines = 2, size = "body", className }: { lines?: number; size?: "caption" | "body"; className?: string }) {
  return (
    <div aria-hidden="true" className={cx("flex flex-col", size === "body" ? "gap-2.5" : "gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cx("skeleton", size === "body" ? "h-4" : "h-3")} style={{ width: i === lines - 1 && lines > 1 ? "62%" : "100%" }} />
      ))}
    </div>
  );
}

export function SkeletonGroup({ label = "載入中", className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
