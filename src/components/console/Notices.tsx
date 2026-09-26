"use client";

import { cx } from "@/components/ui";
import type { ConsoleController, Notice } from "@/lib/console/controller";
import { IconClose } from "./icons";

export function Notices({ controller, notices }: { controller: ConsoleController; notices: Notice[] }) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 flex w-[min(560px,90vw)] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite" role="status">
      {notices.map((n) => (
        <div
          key={n.id}
          className={cx(
            "pointer-events-auto flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl backdrop-blur",
            n.tone === "error" && "border-danger/50 bg-[#2a1216]/95 text-fg",
            n.tone === "warn" && "border-warn/40 bg-[#29230f]/95 text-fg",
            n.tone === "ok" && "border-ok/40 bg-[#0f2519]/95 text-fg",
            n.tone === "info" && "border-line bg-panel-2/95 text-fg",
          )}
        >
          <span
            className={cx(
              "mt-1 size-1.5 shrink-0 rounded-full",
              n.tone === "error" ? "bg-danger" : n.tone === "warn" ? "bg-warn" : n.tone === "ok" ? "bg-ok" : "bg-accent-2",
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
