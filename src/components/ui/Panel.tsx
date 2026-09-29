// Panel (legacy export, kept for the stage lab and unmigrated pages): a --surface pane, radius 12,
// no border; optional 36 px header with a 13 / 600 title and actions. Server-safe.
//
//   <Panel title="場景" actions={<Button size="sm">…</Button>}>…</Panel>

import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export function Panel({ title, actions, className, children, ...rest }: HTMLAttributes<HTMLElement> & { title?: ReactNode; actions?: ReactNode }) {
  return (
    <section {...rest} className={cx("flex min-h-0 flex-col rounded-lg bg-surface", className)}>
      {(title || actions) && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-2 px-3">
          <h2 className="truncate text-[13px] leading-[18px] font-semibold text-label">{title}</h2>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
