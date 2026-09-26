import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { cx } from "@/components/ui";
import { Brand } from "./Brand";

export interface Crumb {
  label: string;
  href?: string;
}

/** Top bar for the project sub-pages: brand · breadcrumb · title, actions on the right. */
export function TopBar({
  crumbs,
  title,
  subtitle,
  status,
  actions,
  onNavigate,
  className,
}: {
  crumbs: Crumb[];
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  /** called before following a crumb link; call e.preventDefault() to stay (unsaved changes) */
  onNavigate?: (e: MouseEvent<HTMLAnchorElement>, href: string) => void;
  className?: string;
}) {
  return (
    <header className={cx("sticky top-0 z-20 border-b border-line/70 bg-bg/90 backdrop-blur", className)}>
      <div className="flex min-h-14 items-center gap-4 px-5 py-2">
        <Brand compact />
        <span aria-hidden="true" className="h-6 w-px bg-line" />
        <div className="min-w-0 flex-1">
          <nav aria-label="路徑" className="flex items-center gap-1 text-[11px] text-faint">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">/</span>}
                {c.href ? (
                  <Link href={c.href} onClick={(e) => onNavigate?.(e, c.href!)} className="hover:text-fg">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base font-semibold text-fg">{title}</h1>
            {subtitle && <span className="truncate text-sm text-muted">{subtitle}</span>}
            {status}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
