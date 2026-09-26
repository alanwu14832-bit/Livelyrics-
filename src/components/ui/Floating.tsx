"use client";

// Shared plumbing for floating surfaces (Menu, Popover, Tooltip): a portal layer that keeps the
// trigger's theme scope, and anchored positioning next to the trigger (flip + clamp, origin on the
// trigger side for the scale-in). Surfaces use the Popover API (top layer, light dismiss, Esc).
//
// The layer is a <div data-ui-layer> inside <body> (or the open <dialog> that holds the trigger,
// so floating content stays interactive above a modal). Surfaces copy the trigger's nearest
// data-theme, so a menu opened in the console is console-dark on any page.

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { placeFloating, type Placement } from "./interaction";

/** Where floating content for `anchor` is portalled. */
export function floatingLayer(anchor: Element | null): HTMLElement {
  const dialog = anchor?.closest("dialog");
  if (dialog instanceof HTMLDialogElement) return dialog;
  let layer = document.querySelector<HTMLElement>("body > div[data-ui-layer]");
  if (!layer) {
    layer = document.createElement("div");
    layer.setAttribute("data-ui-layer", "");
    document.body.appendChild(layer);
  }
  return layer;
}

/** The trigger's theme scope (light | dark | console), if an element sets one. */
export function themeOf(anchor: Element | null): string | undefined {
  return anchor?.closest("[data-theme]")?.getAttribute("data-theme") ?? undefined;
}

/** Place `floating` next to `anchor` (both in the viewport) and set its transform origin. */
export function positionFloating(anchor: Element, floating: HTMLElement, placement: Placement, offset = 6) {
  const a = anchor.getBoundingClientRect();
  // layout size, not the rect: the surface may still be scaled by its entrance transition
  const p = placeFloating({
    anchor: { left: a.left, top: a.top, width: a.width, height: a.height },
    floating: { width: floating.offsetWidth, height: floating.offsetHeight },
    viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
    placement,
    offset,
  });
  floating.style.left = `${p.left}px`;
  floating.style.top = `${p.top}px`;
  floating.style.setProperty("--popover-origin", p.origin);
  floating.dataset.side = p.side;
  return p;
}

/** Keep a shown surface attached to its trigger while the page scrolls or resizes. */
export function useFollowAnchor(open: boolean, anchor: RefObject<Element | null>, floating: RefObject<HTMLElement | null>, placement: Placement, offset = 6) {
  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (anchor.current && floating.current) positionFloating(anchor.current, floating.current, placement, offset);
      });
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchor, floating, placement, offset]);
}

export type OpenFocus = "first" | "last" | "surface" | "none";

/**
 * An anchored popover="auto" surface: open/close state synced with the browser (light dismiss,
 * Esc), focus moved in on open and back to the trigger on close, and the trigger-click race with
 * light dismiss handled. Returns props for the trigger and the surface.
 */
export function useAnchoredSurface({ placement, offset = 6, onOpenChange, focusables }: { placement: Placement; offset?: number; onOpenChange?: (open: boolean) => void; focusables: string }) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [layer, setLayer] = useState<{ el: HTMLElement; theme?: string } | null>(null);
  const [request, setRequest] = useState<{ focus: OpenFocus; n: number } | null>(null);
  const openAtPointerDown = useRef<boolean | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  const show = useCallback((focus: OpenFocus) => {
    const t = triggerRef.current;
    if (!t) return;
    setLayer((cur) => cur ?? { el: floatingLayer(t), theme: themeOf(t) });
    setRequest((r) => ({ focus, n: (r?.n ?? 0) + 1 }));
  }, []);

  const hide = useCallback(() => {
    const s = surfaceRef.current;
    if (s?.matches(":popover-open")) s.hidePopover();
  }, []);

  // open once the portal exists: showPopover, position, move focus
  useLayoutEffect(() => {
    const s = surfaceRef.current;
    const t = triggerRef.current;
    if (!request || !s || !t) return;
    if (!s.matches(":popover-open")) s.showPopover();
    positionFloating(t, s, placement, offset);
    const items = Array.from(s.querySelectorAll<HTMLElement>(focusables));
    if (request.focus === "first") (items[0] ?? s).focus({ preventScroll: true });
    else if (request.focus === "last") (items[items.length - 1] ?? s).focus({ preventScroll: true });
    else if (request.focus === "surface") s.focus({ preventScroll: true });
  }, [request, placement, offset, focusables]);

  // browser-driven changes (light dismiss, Esc) flow back into React
  useLayoutEffect(() => {
    const s = surfaceRef.current;
    if (!s) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === "open";
      setOpen(isOpen);
      onOpenChangeRef.current?.(isOpen);
      if (!isOpen) {
        const active = document.activeElement;
        if (!active || active === document.body || s.contains(active)) triggerRef.current?.focus({ preventScroll: true });
      }
    };
    s.addEventListener("toggle", onToggle);
    return () => s.removeEventListener("toggle", onToggle);
  }, [layer]);

  useFollowAnchor(open, triggerRef, surfaceRef, placement, offset);

  const triggerProps = {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
    },
    "aria-expanded": open,
    onPointerDown: () => {
      openAtPointerDown.current = open;
    },
    onClick: (e: { detail: number }) => {
      const was = openAtPointerDown.current ?? open;
      openAtPointerDown.current = null;
      if (was) hide();
      else show(e.detail === 0 ? "first" : "surface");
    },
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        show(e.key === "ArrowDown" ? "first" : "last");
      }
    },
  };

  return { open, show, hide, triggerRef, surfaceRef, layer, triggerProps };
}
