"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import { formatTimeShort } from "@/lib/timeline";
import type { DesignPlan } from "@/lib/types";
import { drawWaveform, fitCanvas } from "@/components/upload/waveform";
import { effectiveEnd, formatTimeInput, lineAt, type EditorLine } from "./editor-model";
import type { Playhead } from "./playhead";

const COLORS = {
  bg: "#12141a",
  wave: "#3a4050",
  waveActive: "#5b6172",
  span: "rgba(139,108,255,0.14)",
  spanCurrent: "rgba(139,108,255,0.34)",
  marker: "#8b6cff",
  markerTap: "#ff5a36",
  playhead: "#ffffff",
  text: "#e9ebf1",
  muted: "#8d93a3",
  grid: "rgba(255,255,255,0.06)",
  hover: "rgba(255,255,255,0.35)",
};

const HIT_PX = 6;

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
  const drag = useRef<{ kind: "seek" } | { kind: "marker"; index: number } | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const rafRef = useRef(0);

  useEffect(() => {
    propsRef.current = props;
    drawRef.current();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let font = "12px sans-serif";
    try {
      font = `12px ${getComputedStyle(document.body).fontFamily}`;
    } catch {
      /* default */
    }

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
      ctx.fillStyle = COLORS.bg;
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
          ctx.fillStyle = s.colorway[1] ?? COLORS.marker;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x0, 0, Math.max(1, x1 - x0 - 1), bandH);
          ctx.globalAlpha = 1;
        }
      }

      // seconds grid in window mode
      if (p.window !== "full") {
        ctx.fillStyle = COLORS.grid;
        ctx.font = "10px ui-monospace, monospace";
        for (let s = Math.ceil(a); s <= b; s++) {
          const gx = Math.round(x(s)) + 0.5;
          ctx.fillRect(gx, bandH, 1, H - bandH);
          if (s % 2 === 0) {
            ctx.fillStyle = COLORS.muted;
            ctx.globalAlpha = 0.6;
            ctx.fillText(formatTimeShort(s), gx + 3, H - 4);
            ctx.globalAlpha = 1;
            ctx.fillStyle = COLORS.grid;
          }
        }
      }

      // waveform
      drawWaveform(ctx, p.peaks, { x: 0, y: bandH + 2, width: W, height: H - bandH - 4, color: COLORS.wave, from: a / dur, to: b / dur, bar: 2, gap: 1 });

      // line spans + markers
      const t = p.playhead.getTime();
      const current = lineAt(p.lines, t, dur);
      ctx.font = font;
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
        ctx.fillStyle = i === current ? COLORS.spanCurrent : COLORS.span;
        ctx.fillRect(x0, bandH, Math.max(1, x1 - x0), H - bandH);
        const isHover = hover.current?.marker === i || (drag.current?.kind === "marker" && drag.current.index === i);
        ctx.fillStyle = p.tapPointer === i ? COLORS.markerTap : COLORS.marker;
        ctx.fillRect(Math.round(x0) - (isHover ? 1 : 0), bandH, isHover ? 3 : 1.5, H - bandH);
        if (p.labels) {
          const next = timed[k + 1]?.l.start ?? e;
          const room = Math.min(x(next), W) - x0 - 8;
          if (room > 24) {
            ctx.fillStyle = i === current ? COLORS.text : COLORS.muted;
            let text = l.text || "（空白）";
            while (text.length > 1 && ctx.measureText(text).width > room) text = text.slice(0, -2) + "…";
            ctx.fillText(text, x0 + 5, bandH + 5);
          }
        }
      }

      // hover line + time
      const hv = hover.current;
      if (hv && !drag.current) {
        ctx.fillStyle = COLORS.hover;
        ctx.fillRect(Math.round(hv.x), bandH, 1, H - bandH);
      }

      // playhead
      const px = x(t);
      if (px >= -2 && px <= W + 2) {
        ctx.fillStyle = COLORS.playhead;
        ctx.fillRect(Math.round(px) - 1, 0, 2, H);
        ctx.beginPath();
        ctx.moveTo(px - 5, 0);
        ctx.lineTo(px + 5, 0);
        ctx.lineTo(px, 6);
        ctx.closePath();
        ctx.fill();
      }

      // readout for hovered marker / hover time
      if (hv) {
        const time = a + (hv.x / W) * (b - a);
        const label = hv.marker != null ? `${formatTimeInput(p.lines[hv.marker]?.start ?? time)}  ${p.lines[hv.marker]?.text ?? ""}` : formatTimeInput(time);
        ctx.font = "11px ui-monospace, monospace";
        const w = Math.min(W - 8, ctx.measureText(label).width + 10);
        const lx = Math.min(W - w - 4, Math.max(4, hv.x + 6));
        ctx.fillStyle = "rgba(11,12,16,0.9)";
        ctx.fillRect(lx, H - 20, w, 16);
        ctx.fillStyle = COLORS.text;
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

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = propsRef.current;
      const m = markerAt(e.clientX);
      canvas.setPointerCapture(e.pointerId);
      if (m != null) {
        drag.current = { kind: "marker", index: m };
        p.onDragMarker?.(m, timeAt(e.clientX), "start");
      } else {
        drag.current = { kind: "seek" };
        p.playhead.seek(timeAt(e.clientX));
      }
      request();
    };
    const onMove = (e: PointerEvent) => {
      const p = propsRef.current;
      const rect = canvas.getBoundingClientRect();
      const d = drag.current;
      if (d?.kind === "marker") p.onDragMarker?.(d.index, timeAt(e.clientX), "move");
      else if (d?.kind === "seek") p.playhead.seek(timeAt(e.clientX));
      const marker = d ? (d.kind === "marker" ? d.index : null) : markerAt(e.clientX);
      hover.current = { x: e.clientX - rect.left, marker };
      canvas.style.cursor = marker != null ? "ew-resize" : "pointer";
      request();
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (d?.kind === "marker") propsRef.current.onDragMarker?.(d.index, timeAt(e.clientX), "end");
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
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={props.label}
      className={cx("block w-full touch-none select-none rounded-md border border-line", props.className)}
    />
  );
}
