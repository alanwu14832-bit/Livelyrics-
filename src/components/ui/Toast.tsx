"use client";

// Toast stack (UI-AUDIT §3.3 Toast / Banner, UI-34): console notices (top right, under the top bar)
// and the editor's footer toast (bottom centre). iOS banner look: width 360, radius 14,
// --material-thick (solid in the console), --shadow-overlay, padding 10 12, a 16 px semantic icon,
// 13 / 18 --label text, a 28 px close button. At most 3, 8 px apart; errors are role="alert", the
// rest role="status".
//
// Motion (Sonner principles): every toast sets its own transform (no parent variable); a new one
// materializes from 8 px above (scale .98, blur) and the others make room with the CSS spring;
// leaving ones fade out along the same path in 150 ms. Timers pause while the stack is hovered,
// holds focus, or the tab is hidden. Swipe a toast right to dismiss it (velocity counts).
// Reduced motion: opacity only.
//
//   const toasts = useToasts();
//   toasts.push({ tone: "error", message: "投影視窗沒有回應。" });
//   <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
//   <ToastStack placement="bottom-center" … />
//
// A toast without `duration` lives TOAST_DURATION_MS[tone] (4.5 s; errors 9 s); Infinity is sticky.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createVelocityTracker, rubberband, shouldDismiss, springSnappy } from "@/lib/motion";
import { Button } from "./Button";
import { cx } from "./cx";
import { springTo, type Playback } from "./spring";
import { useReducedMotion } from "./use-reduced-motion";
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, WarningIcon, XIcon } from "./kit-icons";
import { mergePresence, stackOffsets, TOAST_DURATION_MS, type Presence } from "./interaction";

export type ToastTone = "info" | "ok" | "warn" | "error";

export interface ToastItem {
  id: string;
  tone?: ToastTone;
  message: ReactNode;
  /** optional bold first line */
  title?: ReactNode;
  action?: { label: string; onClick: () => void };
  /** ms; Infinity keeps it until dismissed */
  duration?: number;
}

const ICONS: Record<ToastTone, ReactNode> = {
  error: <WarningCircleIcon size={16} weight="fill" className="text-red" />,
  warn: <WarningIcon size={16} weight="fill" className="text-orange" />,
  ok: <CheckCircleIcon size={16} weight="fill" className="text-green" />,
  info: <InfoIcon size={16} weight="fill" className="text-label-2" />,
};

const SURFACE =
  "flex w-full items-start gap-2.5 rounded-xl py-2.5 pr-1.5 pl-3 text-[13px] leading-[18px] text-label shadow-overlay material-thick in-data-[theme=console]:bg-elevated in-data-[theme=console]:[backdrop-filter:none] in-data-[theme=console]:[-webkit-backdrop-filter:none]";

function ToastBody({ toast, onClose }: { toast: ToastItem; onClose?: () => void }) {
  const tone = toast.tone ?? "info";
  return (
    <>
      <span className="flex shrink-0 pt-[6px]" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className="min-w-0 flex-1 py-[5px]">
        {toast.title && <p className="font-semibold">{toast.title}</p>}
        <div className="break-words">{toast.message}</div>
      </div>
      {toast.action && (
        <Button variant="plain" size="sm" className="shrink-0" onClick={toast.action.onClick}>
          {toast.action.label}
        </Button>
      )}
      <Button variant="quiet" size="icon-sm" aria-label="關閉通知" icon={XIcon} onClick={onClose} className="shrink-0" />
    </>
  );
}

/** Static toast for /ui-lab. */
export function ToastPreview({ toast }: { toast: Omit<ToastItem, "id"> }) {
  return (
    <div role={toast.tone === "error" ? "alert" : "status"} className={SURFACE}>
      <ToastBody toast={{ ...toast, id: "preview" }} />
    </div>
  );
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

export function ToastStack({
  toasts,
  onDismiss,
  placement = "top-right",
  max = 3,
  className,
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
  placement?: "top-right" | "bottom-center";
  max?: number;
  className?: string;
}) {
  // newest first
  const visible = useMemo(() => toasts.slice(-max).reverse(), [toasts, max]);
  const [prev, setPrev] = useState(visible);
  const [rendered, setRendered] = useState<Presence<ToastItem>[]>(() => mergePresence([], visible, (t) => t.id));
  if (visible !== prev) {
    setPrev(visible);
    setRendered((r) => mergePresence(r, visible, (t) => t.id));
  }
  const exitingKey = rendered
    .filter((r) => r.exiting)
    .map((r) => r.key)
    .join(",");
  useEffect(() => {
    if (!exitingKey) return;
    const t = setTimeout(() => setRendered((r) => r.filter((x) => !x.exiting)), 220);
    return () => clearTimeout(t);
  }, [exitingKey]);

  const [heights, setHeights] = useState<Record<string, number>>({});
  const onHeight = useCallback((id: string, h: number) => setHeights((cur) => (cur[id] === h ? cur : { ...cur, [id]: h })), []);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hidden = useSyncExternalStore(subscribeVisibility, () => document.hidden, () => false);
  const paused = hovered || focused || hidden;

  // live toasts close ranks at once; leaving ones keep their slot while they fade
  const liveOffsets = stackOffsets(
    rendered.filter((r) => !r.exiting).map((r) => heights[r.key] ?? 56),
    8,
  );
  const allOffsets = stackOffsets(
    rendered.map((r) => heights[r.key] ?? 56),
    8,
  );
  let live = 0;
  const top = placement === "top-right";

  return (
    <div
      className={cx(
        "pointer-events-none fixed z-50 w-[360px] max-w-[calc(100vw-24px)]",
        top ? "top-16 right-3" : "bottom-6 left-1/2 -translate-x-1/2",
        className,
      )}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {rendered.map((r, i) => {
        const offset = r.exiting ? allOffsets[i] : liveOffsets[live++];
        return (
          <ToastSlot
            key={r.key}
            toast={r.item}
            exiting={r.exiting}
            offset={top ? offset : -offset}
            top={top}
            paused={paused}
            onDismiss={onDismiss}
            onHeight={onHeight}
            onHover={setHovered}
          />
        );
      })}
    </div>
  );
}

function ToastSlot({
  toast,
  exiting,
  offset,
  top,
  paused,
  onDismiss,
  onHeight,
  onHover,
}: {
  toast: ToastItem;
  exiting: boolean;
  offset: number;
  top: boolean;
  paused: boolean;
  onDismiss: (id: string) => void;
  onHeight: (id: string, h: number) => void;
  onHover: (h: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const tone = toast.tone ?? "info";
  const duration = toast.duration ?? TOAST_DURATION_MS[tone];
  const remaining = useRef(duration);
  const swipe = useRef<{ x0: number; dx: number; w: number; tracker: ReturnType<typeof createVelocityTracker> } | null>(null);
  const fling = useRef<Playback | null>(null);
  const hoverRef = useRef(false);
  const hover = (h: boolean) => {
    hoverRef.current = h;
    onHover(h);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    onHeight(toast.id, el.offsetHeight);
    const ro = new ResizeObserver(() => onHeight(toast.id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [toast.id, onHeight]);

  useEffect(() => {
    if (exiting || paused || !Number.isFinite(duration)) return;
    const start = performance.now();
    const t = setTimeout(() => onDismiss(toast.id), Math.max(0, remaining.current));
    return () => {
      clearTimeout(t);
      remaining.current -= performance.now() - start;
    };
  }, [exiting, paused, duration, toast.id, onDismiss]);

  useEffect(
    () => () => {
      fling.current?.stop();
      // removed under the pointer: pointerleave never comes
      if (hoverRef.current) onHover(false);
    },
    [onHover],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || e.button !== 0 || (e.target as Element).closest("button, a")) return;
    fling.current?.stop();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const tracker = createVelocityTracker();
    tracker.add(e.timeStamp, e.clientX);
    swipe.current = { x0: e.clientX, dx: 0, w: el.offsetWidth, tracker };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s) return;
    s.tracker.add(e.timeStamp, e.clientX);
    const raw = e.clientX - s.x0;
    s.dx = raw >= 0 ? raw : rubberband(raw, s.w);
    e.currentTarget.style.translate = `${s.dx}px 0`;
    e.currentTarget.style.opacity = String(1 - Math.min(0.6, Math.max(0, s.dx) / s.w));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    const el = e.currentTarget;
    if (!s || s.dx === 0) return;
    const v = s.tracker.velocity(e.timeStamp);
    const set = (x: number) => {
      el.style.translate = `${x}px 0`;
    };
    if (shouldDismiss(s.dx, v, s.w, { threshold: 0.4 })) {
      fling.current = springTo({ from: s.dx, to: s.w + 40, velocity: Math.max(0, v), response: 0.2, onUpdate: set, onComplete: () => onDismiss(toast.id) });
    } else {
      el.style.opacity = "";
      fling.current = springTo({ from: s.dx, to: 0, velocity: v, response: springSnappy.visualDuration, onUpdate: set, onComplete: () => (el.style.translate = "") });
    }
  };

  return (
    <div
      ref={ref}
      role={tone === "error" ? "alert" : "status"}
      data-exiting={exiting || undefined}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ "--y": `${offset}px`, "--from": top ? "-8px" : "8px" } as CSSProperties}
      className={cx(
        SURFACE,
        "pointer-events-auto absolute right-0 touch-pan-y",
        top ? "top-0" : "bottom-0",
        // bridge the gap to the next toast so hover (and the paused timer) holds across the stack
        "after:absolute after:inset-x-0 after:h-2",
        top ? "after:top-full" : "after:bottom-full",
        "[transform:translateY(var(--y))]",
        "[transition:transform_var(--dur-spring)_var(--ease-spring),opacity_var(--dur-toast)_var(--ease-out),filter_var(--dur-toast)_var(--ease-out)]",
        "starting:[transform:translateY(calc(var(--y)_+_var(--from)))_scale(0.98)] starting:opacity-0 starting:blur-[4px]",
        "data-exiting:pointer-events-none data-exiting:[transform:translateY(calc(var(--y)_+_var(--from)))_scale(0.98)] data-exiting:opacity-0 data-exiting:[transition:transform_var(--dur-exit)_var(--ease-out),opacity_var(--dur-exit)_var(--ease-out)]",
        "motion-reduce:[transition:opacity_var(--dur-fast)_ease] motion-reduce:starting:blur-none",
      )}
    >
      <ToastBody toast={toast} onClose={() => onDismiss(toast.id)} />
    </div>
  );
}

let seq = 0;

/** Local toast queue for pages without a controller (lyrics editor, /ui-lab). */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id"> & { id?: string }) => {
    const id = t.id ?? `toast-${++seq}`;
    setToasts((list) => [...list.filter((x) => x.id !== id), { ...t, id }]);
    return id;
  }, []);
  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const clear = useCallback(() => setToasts([]), []);
  return { toasts, push, dismiss, clear };
}
