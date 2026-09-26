"use client";

// Deprecated: the pre-redesign sub-page top bar, now a thin wrapper over the kit's AppHeader
// (UI-AUDIT UI-07: one 52 px header on every page, the back link always 「‹ 作品庫」, the title always
// in the same place). New code uses AppHeader from @/components/ui directly; this stays only
// until the lyrics editor has moved over.
//
// Mapping: crumbs -> the back link (the first crumb with an href; the label is always 作品庫);
// title / subtitle -> the title block; status -> next to the title; actions -> the right slot;
// onNavigate(e, href) runs before the back link navigates (call e.preventDefault() to stay).

import type { MouseEvent, ReactNode } from "react";
import { AppHeader } from "@/components/ui";

export interface Crumb {
  label: string;
  href?: string;
}

/** @deprecated use AppHeader from @/components/ui */
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
  /** called before following the back link; call e.preventDefault() to stay (unsaved changes) */
  onNavigate?: (e: MouseEvent<HTMLAnchorElement>, href: string) => void;
  className?: string;
}) {
  const href = crumbs.find((c) => c.href)?.href ?? "/";
  return (
    <AppHeader
      back={{ href, onNavigate: onNavigate ? (e) => onNavigate(e, href) : undefined }}
      title={title}
      subtitle={subtitle}
      titleAccessory={status}
      actions={actions}
      width="full"
      className={className}
    />
  );
}
