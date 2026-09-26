"use client";

// Tooltip (UI-AUDIT UI-25, §3.3): replaces the native title for labels and shortcut hints. The
// first one waits 400 ms; while one is open, or within 600 ms after one closed, the next appears
// at once and without animation (emil-design-eng › Tooltips). Enter 125 ms (scale .97 + opacity +
// a little blur, from the trigger side), exit 100 ms. Never while a pointer button is held (drags)
// or behind an open modal dialog; hides on pointer-down, blur and Esc; keyboard focus shows it.
// Look: --material-thick (solid in the console), radius 8, padding 6 10, 12 px --label + Kbd.
//
//   <Tooltip content="黑場" shortcut="B"><Button …/></Tooltip>
//   <Tooltip content="開啟投影視窗" shortcut="O" placement="bottom-end">…</Tooltip>
//
// The child must forward its ref to a DOM element (Button does); the tooltip listens on it. The
// shortcut is also exposed as aria-keyshortcuts; the text is linked with aria-describedby while
// shown (icon-only triggers still need their own aria-label).

import { useReducedMotion } from "motion/react";
import { Children, cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { floatingLayer, positionFloating, themeOf } from "./Floating";
import { ariaKeyShortcut, tooltipTiming, type Placement } from "./interaction";
import { Kbd } from "./Kbd";

// shared warm-up state across all tooltips on the page
const warm = { lastClosedAt: -Infinity, openCount: 0 };

type TriggerElementProps = { ref?: Ref<HTMLElement> };

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") (ref as { current: T }).current = value;
}

export function Tooltip({
  content,
  shortcut,
  children,
  placement = "bottom",
  disabled = false,
}: {
  content: ReactNode;
  /** key combo shown as a Kbd, e.g. "B", "Shift+ArrowUp" */
  shortcut?: string;
  children: ReactElement<TriggerElementProps>;
  placement?: Placement;
  disabled?: boolean;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [layer, setLayer] = useState<{ el: HTMLElement; theme?: string } | null>(null);
  const [state, setState] = useState<"closed" | "open" | "instant">("closed");

  // the trigger keeps its own ref; the tooltip only needs the element
  const child = Children.only(children);
  const childRef = child.props.ref;
  const childRefLatest = useRef(childRef);
  useLayoutEffect(() => {
    childRefLatest.current = childRef;
  });
  const setRef = useCallback((el: HTMLElement | null) => {
    setAnchor(el);
    assignRef(childRefLatest.current, el);
  }, []);

  // pointer / focus / key listeners live on the trigger element itself (native, so the child's
  // own React handlers stay untouched)
  useEffect(() => {
    if (!anchor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    const blocked = () => {
      if (disabled) return true;
      const modal = document.querySelector("dialog:modal");
      return modal != null && !modal.contains(anchor);
    };
    const reveal = (instant: boolean) => {
      if (blocked()) return;
      shown = true;
      setLayer((cur) => cur ?? { el: floatingLayer(anchor), theme: themeOf(anchor) });
      setState(instant ? "instant" : "open");
    };
    const schedule = () => {
      clearTimeout(timer);
      if (blocked()) return;
      const t = tooltipTiming({ now: performance.now(), lastClosedAt: warm.lastClosedAt, anyOpen: warm.openCount > 0 });
      if (t.delay === 0) reveal(t.instant);
      else timer = setTimeout(() => reveal(false), t.delay);
    };
    const close = () => {
      clearTimeout(timer);
      if (shown) warm.lastClosedAt = performance.now();
      shown = false;
      setState("closed");
    };
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.buttons !== 0) return;
      schedule();
    };
    const onFocus = () => {
      if (anchor.matches(":focus-visible")) schedule();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shown) close();
    };
    anchor.addEventListener("pointerenter", onEnter);
    anchor.addEventListener("pointerleave", close);
    anchor.addEventListener("pointerdown", close);
    anchor.addEventListener("focus", onFocus);
    anchor.addEventListener("blur", close);
    anchor.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      anchor.removeEventListener("pointerenter", onEnter);
      anchor.removeEventListener("pointerleave", close);
      anchor.removeEventListener("pointerdown", close);
      anchor.removeEventListener("focus", onFocus);
      anchor.removeEventListener("blur", close);
      anchor.removeEventListener("keydown", onKey);
    };
  }, [anchor, disabled]);

  // shortcut for assistive tech; description linked while shown
  useEffect(() => {
    if (!anchor || !shortcut) return;
    const prev = anchor.getAttribute("aria-keyshortcuts");
    anchor.setAttribute("aria-keyshortcuts", ariaKeyShortcut(shortcut));
    return () => {
      if (prev == null) anchor.removeAttribute("aria-keyshortcuts");
      else anchor.setAttribute("aria-keyshortcuts", prev);
    };
  }, [anchor, shortcut]);

  // show / hide the popover="manual" surface, positioned at the trigger
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !anchor) return;
    if (state === "closed") {
      if (tip.matches(":popover-open")) tip.hidePopover();
      return;
    }
    if (!tip.matches(":popover-open")) tip.showPopover();
    positionFloating(anchor, tip, placement, 6);
    const prev = anchor.getAttribute("aria-describedby");
    anchor.setAttribute("aria-describedby", cx(prev, id));
    warm.openCount++;
    return () => {
      warm.openCount--;
      if (prev == null) anchor.removeAttribute("aria-describedby");
      else anchor.setAttribute("aria-describedby", prev);
    };
  }, [state, layer, placement, anchor, id]);

  return (
    <>
      {/* only a ref callback is attached; it reads childRefLatest at commit time, never during render */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {cloneElement(child, { ref: setRef })}
      {layer &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            popover="manual"
            data-theme={layer.theme}
            data-instant={state === "instant" || undefined}
            className={cx(
              "pointer-events-none fixed [inset:auto] m-0 flex max-w-[280px] origin-(--popover-origin) items-center gap-1.5 rounded-sm border-0 px-2.5 py-1.5 text-[12px] leading-4 text-label shadow-overlay material-thick",
              "data-[theme=console]:bg-elevated data-[theme=console]:[backdrop-filter:none] in-data-[theme=console]:bg-elevated in-data-[theme=console]:[backdrop-filter:none]",
              "transition-[opacity,scale,filter,display,overlay] duration-[125ms] ease-out transition-discrete",
              "starting:open:opacity-0 not-open:opacity-0 not-open:duration-100",
              !reduce && "starting:open:scale-97 starting:open:blur-[3px]",
              "data-instant:transition-none",
            )}
          >
            <span className="min-w-0">{content}</span>
            {shortcut && <Kbd keys={shortcut} />}
          </div>,
          layer.el,
        )}
    </>
  );
}

/** Static surface for /ui-lab: the tooltip as it looks when shown. */
export function TooltipPreview({ content, shortcut }: { content: ReactNode; shortcut?: string }) {
  return (
    <div className="inline-flex max-w-[280px] items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12px] leading-4 text-label shadow-overlay material-thick in-data-[theme=console]:bg-elevated in-data-[theme=console]:[backdrop-filter:none]">
      <span>{content}</span>
      {shortcut && <Kbd keys={shortcut} />}
    </div>
  );
}
