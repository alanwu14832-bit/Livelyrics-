"use client";

// Alert and Sheet (UI-AUDIT §3.3 Sheet and Alert, §3.4, UI-21): one modal implementation on the
// native <dialog> + showModal() (top layer, focus trap, Esc, focus returns to the opener).
// Enter/exit are real CSS transitions (@starting-style; dialog.ui-alert / dialog.ui-sheet in
// globals.css: opacity + scale + a small blur); the content stays mounted until the exit has
// finished. The scrim is a plain --scrim, never blurred (the console preview keeps rendering).
//
// Alert: yes/no questions (delete, re-process, auto-distribute, leave unsaved). 340 wide, radius 14,
// centred 17 / 600 title and 13 / 20 label-2 message, two equal 32 px buttons, no dividers.
// Initial focus on 「取消」; Esc cancels; the scrim does not dismiss.
//   <Alert open={ask} title="刪除「示範之歌」？" message="音檔與設計會一起刪除，無法復原。"
//     confirmLabel="刪除" destructive onConfirm={del} onCancel={() => setAsk(false)} busy={deleting} />
//
// Sheet: import, re-design, shortcuts, connect Claude. 560 or 640 wide, max 85vh, radius 20; a
// 52 px bar (plain 「取消」, 15 / 600 title, the primary action) that grows a hairline once the body
// scrolls. Drag the bar down to dismiss (grab offset kept, velocity projection decides; upward
// rubber-bands; springs back with the release velocity). `instant` opens and closes without any
// animation (keyboard-opened help, ?).
//   <Sheet open={open} onClose={close} title="重新設計" width={640}
//     action={<Button variant="filled" onClick={go}>開始</Button>}
//     onKeyDown={(e) => { if (e.code === "KeyB") blackout(); }}>…</Sheet>
//
// Keys pressed inside a modal do not reach page hotkeys (`isolateKeys`, default on); handle the
// ones that must pass (the console blackout B) in `onKeyDown`. `preview` renders the surface
// inline without a dialog (for /ui-lab).

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { createVelocityTracker, rubberband, shouldDismiss, springSnappy } from "@/lib/motion";
import { Button } from "./Button";
import { cx } from "./cx";
import { springTo, type Playback } from "./spring";
import { useReducedMotion } from "./use-reduced-motion";

const EXIT_FALLBACK_MS = 320;

/** showModal / close in step with `open`, keep content mounted through the exit, sync Esc. */
function useModal({ open, instant, onDismiss, dismissible, initialFocus }: { open: boolean; instant: boolean; onDismiss: () => void; dismissible: boolean; initialFocus?: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setClosing(!open && !instant);
  }
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef({ onDismiss, dismissible, open });
  useEffect(() => {
    latest.current = { onDismiss, dismissible, open };
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.style.transform = "";
      el.style.opacity = "";
      el.style.transition = "";
      try {
        el.showModal();
      } catch {
        el.setAttribute("open", "");
      }
      initialFocus?.current?.focus();
    } else if (!open && el.open) {
      el.close();
      // native close() restores focus; make sure it did not land on <body>
      const back = opener.current;
      if (back && back.isConnected && (document.activeElement === document.body || el.contains(document.activeElement))) back.focus();
    }
  }, [open, initialFocus]);

  // unmount the content once the exit transition has run
  useEffect(() => {
    if (!closing) return;
    const el = ref.current;
    const done = () => setClosing(false);
    const t = setTimeout(done, EXIT_FALLBACK_MS);
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "opacity") done();
    };
    el?.addEventListener("transitionend", onEnd);
    return () => {
      clearTimeout(t);
      el?.removeEventListener("transitionend", onEnd);
    };
  }, [closing]);

  // Esc: keep the state in React; a forced close (browser close watcher) is synced too
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (latest.current.dismissible) latest.current.onDismiss();
    };
    const onClose = () => {
      if (latest.current.open) latest.current.onDismiss();
    };
    el.addEventListener("cancel", onCancel);
    el.addEventListener("close", onClose);
    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("close", onClose);
    };
  }, []);

  return { ref, mounted: open || closing };
}

function keyHandler(onKeyDown: ((e: KeyboardEvent<HTMLDialogElement>) => void) | undefined, isolate: boolean) {
  return (e: KeyboardEvent<HTMLDialogElement>) => {
    onKeyDown?.(e);
    if (isolate) e.stopPropagation();
  };
}

// ---------------------------------------------------------------- Alert

export interface AlertProps {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel: () => void;
  /** solid red confirm button (delete) */
  destructive?: boolean;
  /** the confirm action is running: spinner, nothing dismisses */
  busy?: boolean;
  children?: ReactNode;
  onKeyDown?: (e: KeyboardEvent<HTMLDialogElement>) => void;
  isolateKeys?: boolean;
  preview?: boolean;
  className?: string;
}

export function Alert({ open, title, message, confirmLabel = "確定", cancelLabel = "取消", onConfirm, onCancel, destructive = false, busy = false, children, onKeyDown, isolateKeys = true, preview = false, className }: AlertProps) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { ref, mounted } = useModal({ open: open && !preview, instant: false, onDismiss: onCancel, dismissible: !busy, initialFocus: cancelRef });

  const body = (
    <div className="px-5 pt-5 pb-4 text-center">
      <h2 id={titleId} className="text-[17px] leading-[22px] font-semibold text-label">
        {title}
      </h2>
      {message && (
        <div id={messageId} className="mt-1.5 text-[13px] leading-5 text-label-2">
          {message}
        </div>
      )}
      {children}
      <div className={cx("mt-5 grid gap-2", onConfirm ? "grid-cols-2" : "grid-cols-1")}>
        <Button ref={cancelRef} variant="gray" onClick={onCancel} disabled={busy} className="w-full">
          {cancelLabel}
        </Button>
        {onConfirm && (
          <Button variant={destructive ? "destructive-filled" : "filled"} onClick={onConfirm} loading={busy} disabled={busy} className="w-full disabled:opacity-60">
            {confirmLabel}
          </Button>
        )}
      </div>
    </div>
  );

  if (preview) {
    return (
      <div role="alertdialog" aria-labelledby={titleId} aria-describedby={message ? messageId : undefined} className={cx("w-[340px] max-w-full rounded-xl bg-elevated text-label shadow-sheet", className)}>
        {body}
      </div>
    );
  }
  return (
    <dialog ref={ref} role="alertdialog" aria-labelledby={titleId} aria-describedby={message ? messageId : undefined} onKeyDown={keyHandler(onKeyDown, isolateKeys)} className={cx("ui-alert", className)}>
      {mounted && body}
    </dialog>
  );
}

// ---------------------------------------------------------------- Sheet

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** the primary action, top right (a filled Button) */
  action?: ReactNode;
  /** 「取消」 top left; pass null to hide it */
  cancelLabel?: string | null;
  width?: number;
  children?: ReactNode;
  footer?: ReactNode;
  /** false while a destructive / async step runs (Esc, scrim and drag do nothing) */
  dismissible?: boolean;
  /** open and close without animation (keyboard-opened sheets) */
  instant?: boolean;
  dragToDismiss?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  onKeyDown?: (e: KeyboardEvent<HTMLDialogElement>) => void;
  isolateKeys?: boolean;
  preview?: boolean;
  /** preview only: show the scrolled bar (hairline) */
  previewScrolled?: boolean;
  className?: string;
  bodyClassName?: string;
  "aria-describedby"?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  action,
  cancelLabel = "取消",
  width = 560,
  children,
  footer,
  dismissible = true,
  instant = false,
  dragToDismiss = true,
  initialFocus,
  onKeyDown,
  isolateKeys = true,
  preview = false,
  previewScrolled = false,
  className,
  bodyClassName,
  "aria-describedby": describedBy,
}: SheetProps) {
  const titleId = useId();
  const reduce = useReducedMotion();
  const { ref, mounted } = useModal({ open: open && !preview, instant, onDismiss: onClose, dismissible, initialFocus });
  const [scrolled, setScrolled] = useState(false);
  const downOnBackdrop = useRef(false);
  const drag = useRef<{ startY: number; y: number; moved: boolean; height: number; tracker: ReturnType<typeof createVelocityTracker> } | null>(null);
  const flight = useRef<Playback | null>(null);
  const canDrag = dragToDismiss && !instant && !reduce && dismissible;

  useEffect(() => () => flight.current?.stop(), []);

  const onBarPointerDown = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!canDrag || !el || e.button !== 0) return;
    if ((e.target as Element).closest("button, a, input, textarea, select, [role=button], [contenteditable=true]")) return;
    flight.current?.stop();
    e.currentTarget.setPointerCapture(e.pointerId);
    const tracker = createVelocityTracker();
    tracker.add(e.timeStamp, e.clientY);
    // grab offset: keep the current (maybe mid-spring) position under the pointer
    const t = getComputedStyle(el).transform;
    const current = t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0;
    drag.current = { startY: e.clientY - current, y: current, moved: current !== 0, height: el.getBoundingClientRect().height, tracker };
  };
  const onBarPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    d.tracker.add(e.timeStamp, e.clientY);
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 4) return;
    d.moved = true;
    d.y = dy >= 0 ? dy : rubberband(dy, d.height);
    el.style.transition = "none";
    el.style.transform = `translateY(${d.y}px)`;
  };
  const onBarPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el || !d.moved) return;
    const v = d.tracker.velocity(e.timeStamp);
    const set = (y: number) => {
      el.style.transform = `translateY(${y}px)`;
    };
    if (shouldDismiss(d.y, v, d.height)) {
      const to = d.height + 48;
      const from = d.y;
      flight.current = springTo({
        from,
        to,
        velocity: Math.max(v, 0),
        response: springSnappy.visualDuration,
        onUpdate: (y) => {
          set(y);
          el.style.opacity = String(Math.max(0, 1 - (y - from) / (to - from)));
        },
        onComplete: onClose,
      });
    } else {
      flight.current = springTo({
        from: d.y,
        to: 0,
        velocity: v,
        response: springSnappy.visualDuration,
        onUpdate: set,
        onComplete: () => {
          el.style.transform = "";
          el.style.transition = "";
        },
      });
    }
  };

  const bar = (
    <header
      onPointerDown={onBarPointerDown}
      onPointerMove={onBarPointerMove}
      onPointerUp={onBarPointerUp}
      onPointerCancel={onBarPointerUp}
      className={cx(
        "relative grid h-[52px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 transition-shadow duration-(--dur-fast) ease-[ease]",
        (preview ? previewScrolled : scrolled) && "scroll-edge",
        canDrag && "touch-none",
      )}
    >
      {canDrag && <span aria-hidden="true" className="pointer-events-none absolute top-1.5 left-1/2 h-[5px] w-9 -translate-x-1/2 rounded-full bg-label-4" />}
      <div className="flex min-w-0 justify-start">
        {cancelLabel != null && (
          <Button variant="plain" onClick={onClose} disabled={!dismissible}>
            {cancelLabel}
          </Button>
        )}
      </div>
      <h2 id={titleId} className="min-w-0 truncate text-center text-[15px] leading-5 font-semibold text-label">
        {title}
      </h2>
      <div className="flex min-w-0 justify-end">{action}</div>
    </header>
  );

  const content = (
    <div className="flex max-h-[85vh] min-h-0 flex-col">
      {bar}
      <div
        className={cx("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-5", bodyClassName)}
        onScroll={(e) => {
          const s = e.currentTarget.scrollTop > 0;
          if (s !== scrolled) setScrolled(s);
        }}
      >
        {children}
      </div>
      {footer && <footer className="flex shrink-0 items-center justify-end gap-2 px-5 pb-4">{footer}</footer>}
    </div>
  );

  if (preview) {
    return (
      <div role="dialog" aria-labelledby={titleId} className={cx("max-w-full overflow-hidden rounded-2xl bg-elevated text-label shadow-sheet", className)} style={{ width }}>
        {content}
      </div>
    );
  }
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onKeyDown={keyHandler(onKeyDown, isolateKeys)}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // a click on the scrim targets the <dialog> itself
        if (e.target === e.currentTarget && downOnBackdrop.current && dismissible) onClose();
        downOnBackdrop.current = false;
      }}
      className={cx("ui-sheet overflow-hidden", instant && "ui-instant", className)}
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
    >
      {mounted && content}
    </dialog>
  );
}
