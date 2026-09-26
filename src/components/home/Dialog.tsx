"use client";

// Deprecated: the pre-redesign modal API, now a thin wrapper over the kit's Sheet (UI-AUDIT
// UI-21: one modal implementation on the native <dialog>, CSS enter / exit with the content kept
// mounted until the exit ends, a plain scrim). New code uses Sheet or Alert from
// @/components/ui directly; this stays only until the lyrics editor has moved over.
//
// Mapping: title -> the sheet's 15 / 600 bar title; description -> a 13 px label-2 paragraph at
// the top of the body (aria-describedby); footer -> the sheet footer (it already holds 「取消」, so
// the bar's cancel is hidden); dismissible -> Esc / scrim / drag do nothing while false.

import { useId, type ReactNode } from "react";
import { Sheet } from "@/components/ui";

/** Width in px from the old `w-[min(94vw,44rem)]` class, so existing callers keep their size. */
function widthFromClass(className: string | undefined): number | undefined {
  const m = className?.match(/w-\[min\(\d+vw,(\d+(?:\.\d+)?)rem\)\]/);
  return m ? Math.round(Number(m[1]) * 16) : undefined;
}

/** @deprecated use Sheet / Alert from @/components/ui */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  width,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  width?: number;
  /** false while a destructive/async action is in flight */
  dismissible?: boolean;
}) {
  const descId = useId();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      cancelLabel={footer ? null : "關閉"}
      footer={footer}
      dismissible={dismissible}
      width={width ?? widthFromClass(className) ?? 560}
      aria-describedby={description ? descId : undefined}
    >
      {description && (
        <p id={descId} className="mb-4 text-[13px] leading-5 text-label-2">
          {description}
        </p>
      )}
      {children}
    </Sheet>
  );
}
