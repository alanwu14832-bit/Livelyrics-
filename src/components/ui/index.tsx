// Minimal shared UI primitives for the operator-side pages (dark theme tokens
// from globals.css). Keep them small; feature folders compose them.

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export function Button({
  variant = "secondary",
  size = "md",
  active = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; active?: boolean }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-base",
        variant === "primary" && "bg-accent text-white hover:brightness-110",
        variant === "secondary" && "bg-panel-3 text-fg hover:bg-line border border-line",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-panel-3",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25 border border-danger/40",
        active && "ring-1 ring-accent text-fg bg-accent/15",
        className,
      )}
    />
  );
}

export function Panel({ title, actions, className, children, ...rest }: HTMLAttributes<HTMLElement> & { title?: ReactNode; actions?: ReactNode }) {
  return (
    <section {...rest} className={cx("flex min-h-0 flex-col rounded-lg border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          <h2 className="text-xs font-semibold tracking-wide text-muted">{title}</h2>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "ok" | "warn" | "danger" }) {
  return (
    <span
      {...props}
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none",
        tone === "neutral" && "bg-panel-3 text-muted",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "danger" && "bg-danger/15 text-danger",
        className,
      )}
    />
  );
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      {...props}
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-panel-2 px-1 font-mono text-[10px] text-muted",
        className,
      )}
    />
  );
}
