"use client";

// AppHeader (UI-AUDIT §3.3 Toolbar / AppHeader, UI-07): the one top bar, 52 px on every page, the
// back link always 「‹ 作品庫」 and the title always in the same place.
//
// Page variant (home, process, lyrics editor): sticky; transparent over --bg while the page is at
// the top, then --material-regular with a hairline scroll edge once content scrolls beneath it
// (an IntersectionObserver on a sentinel sets data-scrolled; background 200 ms ease). Content is
// aligned to the page container (`pageContainerClass`, max 1200) or full width (editor).
//   <AppHeader back title="示範之歌" subtitle="示範樂團" actions={<Button href=…>進入控制台</Button>} />
//   <AppHeader leading={<Brand />} />                                     home
//   <AppHeader back={{ onNavigate: guardUnsaved }} width="full" … />      editor
//
// Console variant: solid --surface with a bottom hairline, no material (nothing scrolls under
// it); leading back + title, a centred slot (mode, transport, clock, capsules) and actions.
//   <AppHeader variant="console" back title={…} subtitle={…} center={…} actions={…} />
//
// The header is the view-transition anchor (view-transition-name: app-header) so it stays put
// while page content slides; pass anchor={false} when several headers share a page (/ui-lab).
// The back link navigates with transitionTypes={["pop"]}.

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { CaretLeftIcon } from "./kit-icons";

/** The page container the header aligns to (home and process). */
export const pageContainerClass = "mx-auto w-full max-w-[1200px] px-(--page-gutter)";

export interface BackLinkOptions {
  href?: string;
  label?: string;
  /** runs before navigating; call e.preventDefault() to stay (unsaved changes) */
  onNavigate?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

export function BackLink({ href = "/", label = "作品庫", onNavigate, className }: BackLinkOptions & { className?: string }) {
  return (
    <Link
      href={href}
      transitionTypes={["pop"]}
      onClick={onNavigate}
      className={cx("press-fade -ml-1.5 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-sm pr-2 pl-0.5 text-[15px] leading-5 text-tint-text hover:bg-fill-4", className)}
    >
      <CaretLeftIcon size={17} />
      {label}
    </Link>
  );
}

export function AppHeader({
  variant = "page",
  back,
  leading,
  title,
  subtitle,
  titleAccessory,
  center,
  actions,
  width = "page",
  scrolled: forcedScrolled,
  anchor = true,
  className,
}: {
  variant?: "page" | "console";
  /** 「‹ 作品庫」; true for the defaults */
  back?: boolean | BackLinkOptions;
  /** replaces the back link (home: the brand) */
  leading?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** next to the title, e.g. 「尚未儲存」 */
  titleAccessory?: ReactNode;
  /** console: mode switch, transport, clock, status capsules */
  center?: ReactNode;
  actions?: ReactNode;
  width?: "page" | "full";
  /** force the scrolled look (previews) */
  scrolled?: boolean;
  anchor?: boolean;
  className?: string;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [observed, setObserved] = useState(false);
  const isScrolled = forcedScrolled ?? observed;

  useEffect(() => {
    const el = sentinel.current;
    if (variant !== "page" || forcedScrolled != null || !el) return;
    const io = new IntersectionObserver(([entry]) => setObserved(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [variant, forcedScrolled]);

  const backNode = back ? <BackLink {...(typeof back === "object" ? back : {})} /> : null;
  const isConsole = variant === "console";
  const titleBlock = (title != null || subtitle != null || titleAccessory != null) && (
    <div className="flex min-w-0 flex-col justify-center">
      <div className="flex min-w-0 items-center gap-2">
        {title != null && <h1 className="min-w-0 truncate text-[15px] leading-5 font-semibold text-label">{title}</h1>}
        {titleAccessory}
      </div>
      {subtitle != null && <div className={cx("min-w-0 truncate", isConsole ? "text-[12px] leading-4 text-label-2" : "text-[13px] leading-4 text-label-2-on-material")}>{subtitle}</div>}
    </div>
  );
  const style = anchor ? { viewTransitionName: "app-header" } : undefined;

  if (isConsole) {
    return (
      <header
        className={cx("relative z-20 grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 bg-surface px-3 border-b-hairline", className)}
        style={style}
      >
        <div className="flex min-w-0 items-center gap-3">
          {leading ?? backNode}
          {titleBlock}
        </div>
        <div className="flex items-center gap-2">{center}</div>
        <div className="flex min-w-0 items-center justify-end gap-2">{actions}</div>
      </header>
    );
  }

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="pointer-events-none -mb-px h-px" />
      <header
        data-scrolled={isScrolled || undefined}
        className={cx(
          "sticky top-0 z-20 h-[52px] transition-[background-color,box-shadow] duration-200 ease-[ease]",
          "data-scrolled:scroll-edge data-scrolled:material-regular",
          className,
        )}
        style={style}
      >
        <div className={cx("flex h-full min-w-0 items-center gap-4", width === "page" ? pageContainerClass : "px-(--page-gutter)")}>
          {(leading ?? backNode) && <div className="flex shrink-0 items-center">{leading ?? backNode}</div>}
          <div className="min-w-0 flex-1">{titleBlock}</div>
          {center}
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>
    </>
  );
}
