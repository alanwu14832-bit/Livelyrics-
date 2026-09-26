"use client";

import { cx } from "@/components/ui";
import type { ConsoleController, Notice } from "@/lib/console/controller";
import { IconClose } from "./icons";

export function Notices({ controller, notices }: { controller: ConsoleController; notices: Notice[] }) {
  return (
    <div className="pointer-events-none fixed top-16 left-1/2 z-40 flex w-[min(560px,90vw)] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite" role="status">
      {notices.map((n) => (
        <div
          key={n.id}
          className={cx(
            "pointer-events-auto flex w-full items-start gap-2 rounded-lg border material-thick px-3 py-2 text-xs text-fg shadow-overlay",
            n.tone === "error" && "border-danger/50",
            n.tone === "warn" && "border-warn/40",
            n.tone === "ok" && "border-ok/40",
            n.tone === "info" && "border-line",
          )}
        >
          <span
            className={cx(
              "mt-1 size-1.5 shrink-0 rounded-full",
              n.tone === "error" ? "bg-danger" : n.tone === "warn" ? "bg-warn" : n.tone === "ok" ? "bg-ok" : "bg-label-2",
            )}
            aria-hidden="true"
          />
          <p className="flex-1 leading-relaxed">{n.message}</p>
          <button type="button" onClick={() => controller.dismissNotice(n.id)} className="shrink-0 rounded p-0.5 text-faint hover:text-fg" aria-label="關閉通知">
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
