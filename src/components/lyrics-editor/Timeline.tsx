"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import { formatTimeShort } from "@/lib/timeline";
import type { DesignPlan } from "@/lib/types";
import { drawWaveform, fitCanvas } from "@/components/upload/waveform";
import { readTokens, subscribeAppearance, tokenAlpha } from "@/lib/ui/canvas-tokens";
import { effectiveEnd, formatTimeInput, lineAt, type EditorLine } from "./editor-model";
import type { Playhead } from "./playhead";

/** Canvas colours come from the design tokens of the canvas's own theme scope. */
const TOKENS = {
  bg: ["--fill-4", "rgba(116,116,128,0.08)"],
  wave: ["--label-3", "rgba(60,60,67,0.3)"],
  tint: ["--tint", "#0071e3"],
  tintSoft: ["--tint-soft", "rgba(0,113,227,0.12)"],
  red: ["--red", "#ff3b30"],
  label: ["--label", "#1d1d1f"],
  label2: ["--label-2", "#6e6e73"],
  label3: ["--label-3", "rgba(60,60,67,0.3)"],
  separator: ["--separator", "rgba(60,60,67,0.29)"],
  elevated: ["--elevated", "#ffffff"],
  fontUi: ["--font-ui", "system-ui, sans-serif"],
  fontNumeric: ["--font-numeric", "ui-monospace, monospace"],
} as const;

type Palette = ReturnType<typeof readPalette>;

function readPalette(el: Element) {
  const t = readTokens(el, TOKENS);
  return {
    bg: t.bg,
    wave: t.wave,
    span: t.tintSoft,
    spanCurrent: tokenAlpha(t.tint, 0.3),
    marker: t.tint,
    markerTap: t.red,
    playhead: t.label,
    text: t.label,
    muted: t.label2,
    grid: tokenAlpha(t.separator, 0.45),
    hover: t.label3,
    readoutBg: tokenAlpha(t.elevated, 0.92),
    fontUi: t.fontUi,
    fontNumeric: t.fontNumeric,
  };
}

const HIT_PX = 6;
/** a press on a marker only becomes a drag after this much movement; less is a click (UI-20) */
const DRAG_THRESHOLD_PX = 3;
/** Alt / Option drags the marker at a quarter of the pointer speed */
const FINE_FACTOR = 0.25;

type Drag =
  | { kind: "seek" }
  /** pressed on a marker, not moved far enough yet */
  | { kind: "pending"; index: number; startX: number; grabOffset: number }
  /** dragging: start = timeAt(x) - grabOffset (1:1, respecting where the marker was grabbed) */
  | { kind: "marker"; index: number; grabOffset: number; value: number; lastX: number; fine: boolean };

export interface TimelineProps {
  playhead: Playhead;
  peaks: readonly number[];
  duration: number;
  lines: EditorLine[];
  plan?: DesignPlan | null;
  /** "full" = whole song; a number = seconds of a window that follows the playhead */
  window: "full" | number;
  /** row marked next in tap-sync */
  tapPointer?: number | null;
  /** show line text labels next to markers */
  labels?: boolean;
  className?: string;
  /** a marker drag: commit=false while dragging, true on release */
  onDragMarker?: (index: number, t: number, phase: "start" | "move" | "end") => void;
  label: string;
}

/** Waveform timeline with lyric-line markers, playhead, click/drag seek and draggable markers. */
export function Timeline(props: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const hover = useRef<{ x: number; marker: number | null } | null>(null);
  const drag = useRef<Drag | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const rafRef = useRef(0);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    propsRef.current = props;
    drawRef.current();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let pal: Palette = readPalette(canvas);

    const view = (): [number, number] => {
      const p = propsRef.current;
      const dur = Math.max(0.001, p.duration || p.playhead.getDuration() || 1);
      if (p.window === "full") return [0, dur];
      const w = Math.min(p.window, dur);
      const t = p.playhead.getTime();
      let a = t - w * 0.35;
      a = Math.max(0, Math.min(dur - w, a));
      return [a, a + w];
    };

    const draw = () => {
      rafRef.current = 0;
      const p = propsRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width: W, height: H, dpr } = fitCanvas(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, W, H);
      const dur = Math.max(0.001, p.duration || p.playhead.getDuration() || 1);
      const [a, b] = view();
      const x = (t: number) => ((t - a) / (b - a)) * W;
      const bandH = p.plan ? 5 : 0;

      // plan sections band
      if (p.plan) {
        for (const s of p.plan.sections) {
          const x0 = x(s.start);
          const x1 = x(s.end);
          if (x1 < 0 || x0 > W) continue;
          ctx.fillStyle = s.colorway[1] ?? pal.marker;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x0, 0, Math.max(1, x1 - x0 - 1), bandH);
          ctx.globalAlpha = 1;
        }
      }

      // seconds grid in window mode (labels are drawn after the waveform)
      if (p.window !== "full") {
        ctx.fillStyle = pal.grid;
        for (let s = Math.ceil(a); s <= b; s++) ctx.fillRect(Math.round(x(s)), bandH, 1, H - bandH);
      }

      // waveform
      drawWaveform(ctx, p.peaks, { x: 0, y: bandH + 2, width: W, height: H - bandH - 4, color: pal.wave, from: a / dur, to: b / dur, bar: 2, gap: 1 });

      if (p.window !== "full") {
        ctx.font = `500 11px ${pal.fontNumeric}`;
        ctx.textBaseline = "bottom";
        ctx.fillStyle = pal.muted;
        for (let s = Math.ceil(a); s <= b; s++) {
          if (s % 2 === 0) ctx.fillText(formatTimeShort(s), Math.round(x(s)) + 3, H - 3);
        }
      }

      // line spans + markers
      const t = p.playhead.getTime();
      const current = lineAt(p.lines, t, dur);
      ctx.font = `12px ${pal.fontUi}`;
      ctx.textBaseline = "top";
      const timed = p.lines
        .map((l, i) => ({ l, i }))
        .filter((e) => e.l.start != null)
        .sort((m, n) => (m.l.start as number) - (n.l.start as number));
      for (let k = 0; k < timed.length; k++) {
        const { l, i } = timed[k];
        const s = l.start as number;
        const e = effectiveEnd(p.lines, i, dur) ?? s + 2;
        if (e < a || s > b) continue;
        const x0 = x(s);
        const x1 = x(e);
        ctx.fillStyle = i === current ? pal.spanCurrent : pal.span;
        ctx.fillRect(x0, bandH, Math.max(1, x1 - x0), H - bandH);
        const d = drag.current;
        const isHover = hover.current?.marker === i || ((d?.kind === "marker" || d?.kind === "pending") && d.index === i);
        ctx.fillStyle = p.tapPointer === i ? pal.markerTap : pal.marker;
        ctx.fillRect(Math.round(x0) - (isHover ? 1 : 0), bandH, isHover ? 3 : 2, H - bandH);
        if (p.labels) {
          const next = timed[k + 1]?.l.start ?? e;
          const room = Math.min(x(next), W) - x0 - 8;
          if (room > 24) {
            ctx.fillStyle = i === current ? pal.text : pal.muted;
            let text = l.text || "（空白）";
            while (text.length > 1 && ctx.measureText(text).width > room) text = text.slice(0, -2) + "…";
            ctx.fillText(text, x0 + 5, bandH + 5);
          }
        }
      }

      // hover line + time
      const hv = hover.current;
      if (hv && !drag.current) {
        ctx.fillStyle = pal.hover;
        ctx.fillRect(Math.round(hv.x), bandH, 1, H - bandH);
      }

      // playhead
      const px = x(t);
      if (px >= -2 && px <= W + 2) {
        ctx.fillStyle = pal.playhead;
        ctx.fillRect(Math.round(px) - 1, 0, 2, H);
        ctx.beginPath();
        ctx.moveTo(px - 5, 0);
        ctx.lineTo(px + 5, 0);
        ctx.lineTo(px, 6);
        ctx.closePath();
        ctx.fill();
      }

      // time bubble above the dragged marker (DOM, positioned 1:1 with the pointer, no easing)
      const bubble = bubbleRef.current;
      const dm = drag.current;
      if (bubble) {
        if (dm?.kind === "marker") {
          const text = p.lines[dm.index]?.text ?? "";
          bubble.textContent = `${formatTimeInput(dm.value)}${text ? `  ${text.length > 16 ? text.slice(0, 16) + "…" : text}` : ""}`;
          bubble.style.visibility = "visible";
          const half = bubble.offsetWidth / 2;
          bubble.style.left = `${Math.max(half, Math.min(W - half, x(dm.value)))}px`;
        } else if (bubble.style.visibility !== "hidden") bubble.style.visibility = "hidden";
      }

      // readout for hovered marker / hover time (not while dragging: the bubble shows it)
      if (hv && dm?.kind !== "marker") {
        const time = a + (hv.x / W) * (b - a);
        const label = hv.marker != null ? `${formatTimeInput(p.lines[hv.marker]?.start ?? time)}  ${p.lines[hv.marker]?.text ?? ""}` : formatTimeInput(time);
        ctx.font = `500 12px ${pal.fontUi}`;
        const w = Math.min(W - 8, ctx.measureText(label).width + 10);
        const lx = Math.min(W - w - 4, Math.max(4, hv.x + 6));
        ctx.fillStyle = pal.readoutBg;
        ctx.fillRect(lx, H - 20, w, 16);
        ctx.fillStyle = pal.text;
        ctx.textBaseline = "middle";
        ctx.fillText(label, lx + 5, H - 12, w - 10);
      }
    };

    const request = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
    };
    drawRef.current = request;
    request();
    const unsub = propsRef.current.playhead.subscribe(request);
    const ro = new ResizeObserver(request);
    ro.observe(canvas);
    const unsubAppearance = subscribeAppearance(() => {
      pal = readPalette(canvas);
      request();
    });

    const timeAt = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const [a, b] = view();
      return a + ((clientX - rect.left) / Math.max(1, rect.width)) * (b - a);
    };
    const markerAt = (clientX: number): number | null => {
      const p = propsRef.current;
      if (!p.onDragMarker) return null;
      const rect = canvas.getBoundingClientRect();
      const [a, b] = view();
      let best: number | null = null;
      let bestD = HIT_PX + 1;
      p.lines.forEach((l, i) => {
        if (l.start == null) return;
        const mx = rect.left + ((l.start - a) / (b - a)) * rect.width;
        const d = Math.abs(mx - clientX);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return bestD <= HIT_PX ? best : null;
    };

    const secondsPerPx = () => {
      const [a, b] = view();
      return (b - a) / Math.max(1, canvas.getBoundingClientRect().width);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = propsRef.current;
      const m = markerAt(e.clientX);
      canvas.setPointerCapture(e.pointerId);
      const start = m != null ? p.lines[m]?.start : null;
      if (m != null && start != null) {
        // nothing changes until the pointer has moved DRAG_THRESHOLD_PX: a click stays a click
        drag.current = { kind: "pending", index: m, startX: e.clientX, grabOffset: timeAt(e.clientX) - start };
      } else {
        drag.current = { kind: "seek" };
        p.playhead.seek(timeAt(e.clientX));
      }
      request();
    };
    const onMove = (e: PointerEvent) => {
      const p = propsRef.current;
      const rect = canvas.getBoundingClientRect();
      let d = drag.current;
      if (d?.kind === "pending" && Math.abs(e.clientX - d.startX) >= DRAG_THRESHOLD_PX) {
        const start = p.lines[d.index]?.start ?? timeAt(d.startX) - d.grabOffset;
        p.onDragMarker?.(d.index, start, "start");
        d = drag.current = { kind: "marker", index: d.index, grabOffset: d.grabOffset, value: start, lastX: d.startX, fine: false };
      }
      if (d?.kind === "marker") {
        if (e.altKey) {
          d.value += (e.clientX - d.lastX) * secondsPerPx() * FINE_FACTOR;
          d.fine = true;
        } else {
          // leaving fine mode: re-anchor so the marker does not jump back under the pointer
          if (d.fine) d.grabOffset = timeAt(d.lastX) - d.value;
          d.fine = false;
          d.value = timeAt(e.clientX) - d.grabOffset;
        }
        d.lastX = e.clientX;
        p.onDragMarker?.(d.index, d.value, "move");
      } else if (d?.kind === "seek") p.playhead.seek(timeAt(e.clientX));
      const marker = d ? (d.kind === "seek" ? null : d.index) : markerAt(e.clientX);
      hover.current = { x: e.clientX - rect.left, marker };
      canvas.style.cursor = marker != null ? "ew-resize" : "pointer";
      request();
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (d?.kind === "marker") propsRef.current.onDragMarker?.(d.index, d.value, "end");
      else if (d?.kind === "pending") {
        // a click on a marker selects that line: jump to its start
        const start = propsRef.current.lines[d.index]?.start;
        if (start != null) propsRef.current.playhead.seek(start);
      }
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
      request();
    };
    const onLeave = () => {
      if (!drag.current) hover.current = null;
      request();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      unsub();
      unsubAppearance();
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      drawRef.current = () => {};
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className="relative">
      <canvas ref={canvasRef} role="img" aria-label={props.label} className={cx("block w-full touch-none select-none rounded-sm", props.className)} />
      <div
        ref={bubbleRef}
        aria-hidden="true"
        style={{ visibility: "hidden" }}
        className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 rounded-xs px-2 py-1 text-[12px] leading-4 font-medium whitespace-pre text-label tabular shadow-overlay material-thick"
      />
    </div>
  );
}
