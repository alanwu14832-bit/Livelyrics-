"use client";

// Timeline pane (UI-AUDIT §3.5, UI-35, 3.4.1 item 4). A canvas drawn from design tokens read off
// the canvas itself: waveform label-3 (label-2 once played), section blocks in their colourway at
// 35 %, lyric spans label-3 with the current one in tint (the one "current line" look), cue
// diamonds in their urgency colour, a 2 px white playhead with an 8 px round head.
//
// Direct manipulation is sacred: a press seeks at once, dragging scrubs 1:1 (pointer capture, no
// easing) and a time bubble rides above the playhead while scrubbing. Only the visible window
// moves on springs: zoom (+ / − / 全曲 / ctrl + wheel, anchored, interruptible), continuous follow
// while playing (the playhead holds at 35 %), and panning (wheel, or drag the ruler / shift-drag)
// with momentum on release and rubber-banding past either end. Reduced motion: the window jumps.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { cx } from "@/components/ui";
import { MinusIcon, PlusIcon } from "@/components/ui/Icon";
import { springState } from "@/components/ui/spring";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import type { ConsoleController } from "@/lib/console/controller";
import { formatCountdown, withAlpha } from "@/lib/console/format";
import { selectTimeDecis, useStageValue } from "@/lib/console/hooks";
import { CUE_KIND_LABELS, CUE_KIND_TOKENS, SCENE_LABELS, cueColor } from "@/lib/console/labels";
import { CUE_ACTIVE_WINDOW, sortedCues } from "@/lib/console/navigation";
import {
  followStart,
  maxStart,
  peaksForView,
  spanForZoom,
  stepZoom,
  tickLabel,
  ticks,
  tickStep,
  timeToX,
  xToTime,
  zoomOf,
  type TimeView,
} from "@/lib/console/timeline-geom";
import { createVelocityTracker, projectMomentum, rubberbandClamp } from "@/lib/motion";
import type { PlaybackMode } from "@/lib/stage/protocol";
import { formatTime, lineIndexAt, lineSpan } from "@/lib/timeline";
import type { AudioAnalysis, CueNote, LyricLine, Project, SectionDesign } from "@/lib/types";
import { readTokens, subscribeAppearance, tokenAlpha } from "@/lib/ui/canvas-tokens";
import { ButtonGroup, Pane, PaneHeader } from "./ui";
import { useRafLoop } from "./useRaf";

const RULER_H = 18;
const SECTION_TOP = 20;
const SECTION_H = 20;
const WAVE_TOP = SECTION_TOP + SECTION_H + 6;
const LYRIC_H = 6;
const LYRIC_GAP = 6;
/** window springs: zoom / follow (Apple's default response), and a slower glide after a throw */
const VIEW_RESPONSE = 0.35;
const THROW_RESPONSE = 0.6;
const FOLLOW_ANCHOR = 0.35;
const MANUAL_PAUSE_MS = 3000;
const WHEEL_SETTLE_MS = 140;

interface Palette {
  surface: string;
  label: string;
  label2: string;
  label3: string;
  separator: string;
  tint: string;
  orange: string;
  yellow: string;
  font: string;
  numeric: string;
}

/** Design tokens read from the canvas itself (the console is a dark scope inside the page). */
function readPalette(el: HTMLElement): Palette {
  const t = readTokens(el, {
    surface: ["--surface", "#1c1c1e"],
    label: ["--label", "#ffffff"],
    label2: ["--label-2", "rgba(235,235,245,0.6)"],
    label3: ["--label-3", "rgba(235,235,245,0.3)"],
    separator: ["--separator", "rgba(84,84,88,0.65)"],
    tint: ["--tint", "#0a84ff"],
    orange: ["--orange", "#ff9f0a"],
    yellow: ["--yellow", "#ffd60a"],
    numeric: ["--font-numeric", "ui-monospace, monospace"],
  });
  let font = "sans-serif";
  try {
    font = getComputedStyle(el).fontFamily || font;
  } catch {
    /* default */
  }
  return { ...t, font };
}

const cueToken = (pal: Palette, kind: CueNote["kind"]) => {
  const token = CUE_KIND_TOKENS[kind];
  return token === "--orange" ? pal.orange : token === "--yellow" ? pal.yellow : pal.label2;
};

interface Hover {
  x: number;
  t: number;
  cue: number | null;
}

/** The visible window as two critically damped springs (start, span) with live velocities. */
interface ViewSpring {
  start: number;
  span: number;
  vStart: number;
  vSpan: number;
  toStart: number;
  toSpan: number;
  response: number;
}

function stepSpring(cur: number, vel: number, to: number, dt: number, response: number): [number, number] {
  const { x, v } = springState(dt, cur - to, vel, response);
  return [to + x, v];
}

function TimelineImpl({
  controller,
  project,
  duration,
  fallbackPeaks,
  mode,
}: {
  controller: ConsoleController;
  project: Project;
  duration: number;
  fallbackPeaks: number[] | null;
  mode: PlaybackMode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<Palette | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const total = Math.max(duration, 1);
  const spring = useRef<ViewSpring>({ start: 0, span: total, vStart: 0, vSpan: 0, toStart: 0, toSpan: total, response: VIEW_RESPONSE });
  const viewRef = useRef<TimeView>({ start: 0, span: total });
  const [zoomLabel, setZoomLabel] = useState(1);
  const hoverRef = useRef<Hover | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const scrubRef = useRef<{ pointerId: number } | null>(null);
  const panRef = useRef<{ pointerId: number; x0: number; start0: number; tracker: ReturnType<typeof createVelocityTracker> } | null>(null);
  const wheelRaw = useRef<{ start: number; timer: ReturnType<typeof setTimeout> | undefined } | null>(null);
  const manualUntil = useRef(0);
  const lastFrame = useRef(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [panning, setPanning] = useState(false);
  const [wrapWidth, setWrapWidth] = useState(0);
  const pendingSeek = useRef<number | null>(null);
  const lastKey = useRef("");
  const t = useStageValue(controller.store, selectTimeDecis);
  const versionRef = useRef(0);
  const reduce = useReducedMotion();
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);

  const plan = project.plan;
  const analysis = project.analysis;
  const lines = useMemo(() => project.lyrics?.lines ?? [], [project.lyrics]);
  const cues = useMemo(() => sortedCues(plan), [plan]);
  const peaks = useMemo(() => (analysis?.peaks?.length ? analysis.peaks : (fallbackPeaks ?? null)), [analysis, fallbackPeaks]);
  const peaksDuration = analysis?.peaks?.length && analysis.duration > 0 ? analysis.duration : duration;
  const beats = analysis?.beats ?? [];

  // anything the static drawing depends on bumps the version so the next frame redraws
  useEffect(() => {
    versionRef.current++;
  }, [project, peaks, duration, mode]);

  // a new song length: back to the whole song
  const [prevTotal, setPrevTotal] = useState(total);
  if (total !== prevTotal) {
    setPrevTotal(total);
    setZoomLabel(1);
  }
  useEffect(() => {
    const s = spring.current;
    Object.assign(s, { start: 0, span: total, vStart: 0, vSpan: 0, toStart: 0, toSpan: total });
    viewRef.current = { start: 0, span: total };
    versionRef.current++;
  }, [total]);

  // canvas size follows the wrapper
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    paletteRef.current = readPalette(canvas);
    const unsubAppearance = subscribeAppearance(() => {
      paletteRef.current = readPalette(canvas);
      versionRef.current++;
    });
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      setWrapWidth(w);
      versionRef.current++;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      unsubAppearance();
    };
  }, []);

  /** Retarget the window (zoom); the spring carries on from where it is, with its velocity. */
  const zoomTo = useCallback(
    (zoom: number, anchor?: { time: number; frac: number }) => {
      const s = spring.current;
      const span = spanForZoom(zoom, total);
      const a = anchor ?? { time: controller.songTime(), frac: s.span > 0 ? Math.min(1, Math.max(0, (controller.songTime() - s.start) / s.span)) : 0.5 };
      s.toSpan = span;
      s.toStart = span >= total - 1e-6 ? 0 : Math.min(maxStart(span, total), Math.max(0, a.time - a.frac * span));
      s.response = VIEW_RESPONSE;
      if (reduceRef.current) Object.assign(s, { start: s.toStart, span: s.toSpan, vStart: 0, vSpan: 0 });
      setZoomLabel(Math.round(zoomOf(span, total) * 10) / 10);
      versionRef.current++;
    },
    [controller, total],
  );

  // wheel: ctrl / ⌘ + wheel (and trackpad pinch) zooms around the cursor; plain wheel pans when
  // zoomed, 1:1 with rubber-banding past the ends, springing back when the wheel stops
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const { w } = sizeRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const s = spring.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 33 : 1;
        const factor = Math.exp(-(e.deltaY * unit) * 0.005);
        const frac = Math.min(1, Math.max(0, x / Math.max(1, w)));
        zoomTo(zoomOf(s.toSpan, total) * factor, { time: xToTime(x, { start: s.start, span: s.span }, w), frac });
        return;
      }
      if (s.toSpan >= total - 1e-6) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      manualUntil.current = performance.now() + MANUAL_PAUSE_MS;
      const raw = (wheelRaw.current?.start ?? s.start) + (delta / Math.max(1, w)) * s.span;
      const shown = rubberbandClamp(raw, 0, maxStart(s.span, total), s.span);
      Object.assign(s, { start: shown, toStart: shown, vStart: 0 });
      clearTimeout(wheelRaw.current?.timer);
      wheelRaw.current = {
        start: raw,
        timer: setTimeout(() => {
          wheelRaw.current = null;
          s.toStart = Math.min(maxStart(s.span, total), Math.max(0, s.start));
          s.response = VIEW_RESPONSE;
        }, WHEEL_SETTLE_MS),
      };
      versionRef.current++;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      clearTimeout(wheelRaw.current?.timer);
    };
  }, [total, zoomTo]);

  const cueAtX = useCallback(
    (x: number): number | null => {
      const { w } = sizeRef.current;
      let best: number | null = null;
      let bestD = 7;
      cues.forEach((c, i) => {
        const d = Math.abs(timeToX(c.time, viewRef.current, w) - x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    },
    [cues],
  );

  const pointerTime = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left));
    return { x, y: e.clientY - rect.top, t: xToTime(x, viewRef.current, sizeRef.current.w) };
  };

  const zoomed = () => spring.current.toSpan < total - 1e-6;
  const inPanZone = (y: number) => y < RULER_H;

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    const { x, y, t } = pointerTime(e);
    // pan: the ruler strip, shift-drag or the middle button (only while zoomed)
    if (zoomed() && (e.button === 1 || e.shiftKey || inPanZone(y))) {
      const s = spring.current;
      const tracker = createVelocityTracker();
      tracker.add(e.timeStamp, e.clientX);
      Object.assign(s, { toStart: s.start, vStart: 0 }); // grab it where it is
      panRef.current = { pointerId: e.pointerId, x0: e.clientX, start0: s.start, tracker };
      manualUntil.current = performance.now() + MANUAL_PAUSE_MS;
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    // scrub: seek on press, 1:1 while dragging
    scrubRef.current = { pointerId: e.pointerId };
    setScrubbing(true);
    const cue = cueAtX(x);
    controller.seek(cue != null && y < WAVE_TOP + 10 ? cues[cue].time : t);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y, t } = pointerTime(e);
    const pan = panRef.current;
    if (pan) {
      const s = spring.current;
      pan.tracker.add(e.timeStamp, e.clientX);
      const raw = pan.start0 - ((e.clientX - pan.x0) / Math.max(1, sizeRef.current.w)) * s.span;
      const shown = rubberbandClamp(raw, 0, maxStart(s.span, total), s.span);
      Object.assign(s, { start: shown, toStart: shown, vStart: 0 });
      manualUntil.current = performance.now() + MANUAL_PAUSE_MS;
      versionRef.current++;
      return;
    }
    e.currentTarget.style.cursor = !scrubRef.current && zoomed() && (inPanZone(y) || e.shiftKey) ? "grab" : "";
    const next: Hover = { x, t, cue: scrubRef.current ? null : cueAtX(x) };
    hoverRef.current = next;
    setHover((prev) => (prev && prev.cue === next.cue && Math.abs(prev.x - next.x) < 0.5 ? prev : next));
    if (scrubRef.current) pendingSeek.current = t;
  };

  const endDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pan = panRef.current;
    if (pan) {
      panRef.current = null;
      setPanning(false);
      const s = spring.current;
      const w = Math.max(1, sizeRef.current.w);
      const vPx = pan.tracker.velocity(e.timeStamp);
      // throw: project where the flick is going (Apple's deceleration), then glide there on a
      // spring that starts with the release velocity; past an end it lands on the end
      const secPerPx = s.span / w;
      const projected = s.start - projectMomentum(vPx) * secPerPx;
      s.toStart = Math.min(maxStart(s.span, total), Math.max(0, projected));
      s.vStart = -vPx * secPerPx;
      s.response = THROW_RESPONSE;
      if (reduceRef.current) Object.assign(s, { start: s.toStart, vStart: 0 });
      manualUntil.current = performance.now() + MANUAL_PAUSE_MS;
    }
    if (scrubRef.current) {
      if (pendingSeek.current != null) controller.seek(pendingSeek.current);
      pendingSeek.current = null;
      scrubRef.current = null;
      setScrubbing(false);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  const onPointerLeave = () => {
    hoverRef.current = null;
    setHover(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const now = controller.songTime();
    let target: number | null = null;
    if (e.key === "PageUp") target = now - 5;
    else if (e.key === "PageDown") target = now + 5;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = Math.max(0, duration - 0.5);
    if (target == null) return;
    e.preventDefault();
    e.stopPropagation();
    controller.seek(target);
  };

  useRafLoop((frameNow) => {
    const canvas = canvasRef.current;
    const pal = paletteRef.current;
    if (!canvas || !pal) return;
    if (pendingSeek.current != null) {
      controller.seek(pendingSeek.current);
      pendingSeek.current = null;
    }
    const state = controller.store.get();
    const t = controller.songTime();
    const s = spring.current;
    const dt = Math.min(0.1, Math.max(0, (frameNow - (lastFrame.current || frameNow)) / 1000));
    lastFrame.current = frameNow;

    // follow: the playhead holds at 35 % of a zoomed view while playing (not while the operator
    // drags, pans, or just panned)
    const manual = panRef.current != null || wheelRaw.current != null || performance.now() < manualUntil.current;
    if (state.playing && !scrubRef.current && !manual && s.toSpan < total - 1e-6) {
      s.toStart = followStart(t, s.toSpan, total, FOLLOW_ANCHOR);
      if (s.response !== VIEW_RESPONSE) s.response = VIEW_RESPONSE;
    }
    if (panRef.current == null && wheelRaw.current == null) {
      if (reduceRef.current) Object.assign(s, { start: s.toStart, span: s.toSpan, vStart: 0, vSpan: 0 });
      else if (dt > 0) {
        [s.start, s.vStart] = stepSpring(s.start, s.vStart, s.toStart, dt, s.response);
        [s.span, s.vSpan] = stepSpring(s.span, s.vSpan, s.toSpan, dt, VIEW_RESPONSE);
        const eps = total * 1e-5;
        if (Math.abs(s.start - s.toStart) < eps && Math.abs(s.vStart) < eps * 10) Object.assign(s, { start: s.toStart, vStart: 0 });
        if (Math.abs(s.span - s.toSpan) < eps && Math.abs(s.vSpan) < eps * 10) Object.assign(s, { span: s.toSpan, vSpan: 0 });
      }
    }
    viewRef.current = { start: s.start, span: Math.max(1e-3, s.span) };

    const view = viewRef.current;
    const { w, h, dpr } = sizeRef.current;
    const hv = hoverRef.current;
    const key = `${Math.round(t * 60)}|${view.start.toFixed(4)}|${view.span.toFixed(4)}|${w}|${h}|${dpr}|${hv ? `${hv.x.toFixed(1)}:${hv.cue}` : "-"}|${versionRef.current}|${state.lineIndex}|${state.sectionIndex}|${scrubRef.current ? 1 : 0}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawTimeline(ctx, {
      w,
      h,
      dpr,
      pal,
      view,
      t,
      state: { lineIndex: state.lineIndex, sectionIndex: state.sectionIndex },
      hover: hv,
      dragging: scrubRef.current != null,
      sections: plan?.sections ?? [],
      peaks,
      peaksDuration,
      beats,
      analysis,
      lines,
      duration,
      cues,
    });
  });

  const hoverCue: CueNote | null = hover?.cue != null && !scrubbing ? (cues[hover.cue] ?? null) : null;
  const zoomedIn = zoomLabel > 1.001;
  const bubbleLine = scrubbing && hover && project.lyrics ? lineIndexAt(project.lyrics, hover.t, duration) : null;
  const bubbleText = bubbleLine != null ? lines[bubbleLine]?.text.trim() ?? "" : "";

  return (
    <Pane area="timeline" label="時間軸" order={3}>
      <PaneHeader
        title="時間軸"
        meta={
          <span className="hidden items-center gap-3 min-[1400px]:flex">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-full bg-label-3" aria-hidden="true" />
              歌詞
            </span>
            {(Object.keys(CUE_KIND_LABELS) as Array<CueNote["kind"]>)
              .filter((k) => cues.some((c) => c.kind === k))
              .map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className="size-2 rotate-45 rounded-[1px]" style={{ background: cueColor(k) }} aria-hidden="true" />
                  {CUE_KIND_LABELS[k]}
                </span>
              ))}
          </span>
        }
        actions={
          <>
            <span className="mr-1 text-c-footnote text-label-2 tabular t-latin" aria-live="polite">
              ×{zoomLabel >= 10 ? Math.round(zoomLabel) : zoomLabel.toFixed(1).replace(/\.0$/, "")}
            </span>
            <ButtonGroup
              label="時間軸縮放"
              buttons={[
                { key: "out", label: <MinusIcon size={14} />, ariaLabel: "縮小時間軸", disabled: !zoomedIn, onClick: () => zoomTo(stepZoom(zoomLabel, -1)) },
                { key: "all", label: "全曲", ariaLabel: "顯示全曲", pressed: !zoomedIn, onClick: () => zoomTo(1) },
                { key: "in", label: <PlusIcon size={14} />, ariaLabel: "放大時間軸", disabled: zoomLabel >= 16 - 1e-3, onClick: () => zoomTo(stepZoom(zoomLabel, 1)) },
              ]}
            />
          </>
        }
      />
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="slider"
          aria-label="播放位置（點擊或拖曳跳轉，Page Up／Down 前後 5 秒；放大後拖曳上方刻度平移）"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(t)}
          aria-valuetext={formatTime(t)}
          className={cx("absolute inset-0 touch-none select-none focus-inset", panning ? "cursor-grabbing" : "cursor-default")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown}
        />
        {hover && !scrubbing && !panning && (
          <div
            className="pointer-events-none absolute top-0.5 z-10 rounded-xs bg-elevated px-1.5 py-0.5 text-c-caption text-label tabular shadow-overlay"
            style={{ left: Math.min(Math.max(0, hover.x + 6), Math.max(0, wrapWidth - 64)) }}
          >
            {formatTime(hover.t)}
          </div>
        )}
        {/* scrubbing: time + the line there, above the playhead; instant, no animation */}
        {hover && scrubbing && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-20 flex max-w-[260px] items-baseline gap-2 rounded-sm bg-elevated px-2 py-1 whitespace-nowrap shadow-overlay"
            style={{ left: Math.min(Math.max(4, hover.x - 60), Math.max(4, wrapWidth - 264)) }}
          >
            <span className="text-c-footnote font-semibold text-label tabular">{formatTime(hover.t)}</span>
            {bubbleText && (
              <span className="min-w-0 truncate text-c-footnote text-label-2">
                {bubbleText.length > 16 ? `${bubbleText.slice(0, 16)}…` : bubbleText}
              </span>
            )}
          </div>
        )}
        {hoverCue && hover && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 w-64 rounded-md bg-elevated p-2.5 shadow-overlay"
            style={{ left: Math.min(Math.max(4, hover.x - 128), Math.max(4, wrapWidth - 260)), top: WAVE_TOP + 8 }}
          >
            <div className="flex items-center justify-between gap-2 text-c-footnote">
              <span className="flex items-center gap-1.5 font-semibold text-label">
                <span className="size-2 rotate-45 rounded-[1px]" style={{ background: cueColor(hoverCue.kind) }} aria-hidden="true" />
                {CUE_KIND_LABELS[hoverCue.kind] ?? hoverCue.kind}
              </span>
              <span className="text-label-2 tabular">
                {formatTime(hoverCue.time)}・{hoverCue.time < t - CUE_ACTIVE_WINDOW ? "已經過" : formatCountdown(hoverCue.time - t)}
              </span>
            </div>
            <p className="mt-1 text-c-body font-semibold text-label">{hoverCue.title}</p>
            {hoverCue.detail && <p className="mt-0.5 text-c-footnote text-label-2">{hoverCue.detail}</p>}
          </div>
        )}
      </div>
    </Pane>
  );
}

interface DrawInput {
  w: number;
  h: number;
  dpr: number;
  pal: Palette;
  view: TimeView;
  t: number;
  state: { lineIndex: number | null; sectionIndex: number | null };
  hover: Hover | null;
  dragging: boolean;
  sections: SectionDesign[];
  peaks: readonly number[] | null;
  peaksDuration: number;
  beats: readonly number[];
  analysis: AudioAnalysis | null;
  lines: LyricLine[];
  duration: number;
  cues: CueNote[];
}

function drawTimeline(ctx: CanvasRenderingContext2D, d: DrawInput) {
  const { w, h, dpr, pal, view, t, sections, peaks, peaksDuration, beats, analysis, lines, duration, cues } = d;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const X = (time: number) => timeToX(time, view, w);
  const waveBottom = h - LYRIC_H - LYRIC_GAP - 4;
  const waveMid = (WAVE_TOP + waveBottom) / 2;
  const waveHalf = Math.max(4, (waveBottom - WAVE_TOP) / 2);
  const lyricY = h - LYRIC_H - 4;

  // ruler: label-3 ticks, label-2 numbers
  const step = tickStep(view, w);
  ctx.font = `500 11px ${pal.numeric}`;
  ctx.textBaseline = "middle";
  for (const tick of ticks(view, step)) {
    const x = Math.round(X(tick)) + 0.5;
    ctx.fillStyle = pal.label3;
    ctx.fillRect(x - 0.5, RULER_H - 5, 1, 5);
    ctx.fillStyle = tokenAlpha(pal.separator, 0.45);
    ctx.fillRect(x - 0.5, WAVE_TOP, 1, waveBottom - WAVE_TOP);
    ctx.fillStyle = pal.label2;
    ctx.fillText(tickLabel(tick, step), x + 4, RULER_H / 2 - 1);
  }

  // sections: colourway at 35 % (the current one 55 % with a hairline ring), 12 / 600 name
  sections.forEach((s, i) => {
    const x0 = Math.max(0, X(s.start));
    const x1 = Math.min(w, X(s.end));
    if (x1 <= 0 || x0 >= w || x1 - x0 < 1) return;
    const active = i === d.state.sectionIndex;
    const primary = s.colorway[1] ?? s.colorway[0];
    const accent = s.colorway[2] ?? primary;
    ctx.fillStyle = primary ? withAlpha(primary, active ? 0.55 : 0.35) : tokenAlpha(pal.label3, active ? 1 : 0.6);
    roundRect(ctx, x0 + 1, SECTION_TOP, x1 - x0 - 2, SECTION_H, 5);
    ctx.fill();
    if (accent) {
      ctx.save();
      roundRect(ctx, x0 + 1, SECTION_TOP, x1 - x0 - 2, SECTION_H, 5);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(x0 + 1, SECTION_TOP, 2, SECTION_H);
      ctx.restore();
    }
    if (active) {
      ctx.strokeStyle = tokenAlpha(pal.label, 0.7);
      ctx.lineWidth = 1;
      roundRect(ctx, x0 + 1.5, SECTION_TOP + 0.5, x1 - x0 - 3, SECTION_H - 1, 4.5);
      ctx.stroke();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + 6, SECTION_TOP, Math.max(0, x1 - x0 - 10), SECTION_H);
    ctx.clip();
    ctx.font = `600 12px ${pal.font}`;
    ctx.fillStyle = pal.label;
    ctx.fillText(s.label, x0 + 8, SECTION_TOP + SECTION_H / 2 + 0.5);
    const nameW = ctx.measureText(s.label).width;
    const scene = SCENE_LABELS[s.scene];
    if (scene) {
      ctx.font = `400 12px ${pal.font}`;
      ctx.fillStyle = tokenAlpha(pal.label, 0.7);
      ctx.fillText(scene, x0 + 8 + nameW + 8, SECTION_TOP + SECTION_H / 2 + 0.5);
    }
    ctx.restore();
  });

  // beat grid (only when there is room for it)
  if (beats.length > 1) {
    const pxPerBeat = (w / view.span) * ((beats[beats.length - 1] - beats[0]) / (beats.length - 1));
    if (pxPerBeat >= 9) {
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        if (b < view.start || b > view.start + view.span) continue;
        ctx.fillStyle = tokenAlpha(pal.label, i % 4 === 0 ? 0.1 : 0.045);
        ctx.fillRect(Math.round(X(b)), WAVE_TOP, 1, waveBottom - WAVE_TOP);
      }
    }
  }

  // waveform: label-3, label-2 once played
  if (peaks && peaks.length > 0) {
    const cols = Math.max(1, Math.floor(w / 2));
    const colW = w / cols;
    const values = peaksForView(peaks, peaksDuration, view, cols);
    for (let c = 0; c < cols; c++) {
      const ct = view.start + ((c + 0.5) / cols) * view.span;
      if (ct < 0 || ct > duration) continue;
      const amp = Math.max(0.6, values[c] * waveHalf);
      ctx.fillStyle = ct <= t ? pal.label2 : pal.label3;
      ctx.fillRect(c * colW, waveMid - amp, Math.max(1, colW - 0.6), amp * 2);
    }
  } else {
    ctx.fillStyle = pal.label3;
    ctx.fillRect(0, waveMid - 0.5, w, 1);
    ctx.font = `500 12px ${pal.font}`;
    ctx.fillStyle = pal.label2;
    ctx.textAlign = "center";
    ctx.fillText(peaks ? "沒有波形資料" : "讀取波形中…", w / 2, waveMid - 12);
    ctx.textAlign = "left";
  }

  // energy curve
  const energy = analysis?.energy;
  if (energy && energy.length > 1 && analysis && analysis.envelopeRate > 0) {
    ctx.beginPath();
    const stepPx = 3;
    for (let x = 0; x <= w; x += stepPx) {
      const time = xToTime(x, view, w);
      const i = Math.min(energy.length - 1, Math.max(0, Math.round(time * analysis.envelopeRate)));
      const y = waveBottom - energy[i] * (waveBottom - WAVE_TOP);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = tokenAlpha(pal.label, 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // lyric spans: label-3; the current one tint (the shared "current line" look)
  for (let i = 0; i < lines.length; i++) {
    const span = lineSpan(lines, i, duration);
    if (!span) continue;
    const x0 = X(span[0]);
    const x1 = X(span[1]);
    if (x1 < 0 || x0 > w) continue;
    const current = i === d.state.lineIndex;
    ctx.fillStyle = current ? pal.tint : span[0] <= t ? pal.label2 : pal.label3;
    roundRect(ctx, x0, lyricY, Math.max(2, x1 - x0 - 1.5), LYRIC_H, LYRIC_H / 2);
    ctx.fill();
  }

  // cue markers: urgency colour
  cues.forEach((c, i) => {
    const x = X(c.time);
    if (x < -8 || x > w + 8) return;
    const color = cueToken(pal, c.kind);
    const hot = d.hover?.cue === i;
    ctx.fillStyle = tokenAlpha(color, hot ? 0.9 : 0.5);
    for (let y = WAVE_TOP; y < waveBottom; y += 4) ctx.fillRect(Math.round(x), y, 1, 2);
    const r = hot ? 6 : 4.5;
    ctx.beginPath();
    ctx.moveTo(x, WAVE_TOP - 2 - r);
    ctx.lineTo(x + r, WAVE_TOP - 2);
    ctx.lineTo(x, WAVE_TOP - 2 + r);
    ctx.lineTo(x - r, WAVE_TOP - 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = pal.surface;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // hover
  if (d.hover && !d.dragging) {
    const x = Math.round(d.hover.x) + 0.5;
    ctx.fillStyle = tokenAlpha(pal.label, 0.4);
    ctx.fillRect(x - 0.5, RULER_H, 1, h - RULER_H);
  }

  // playhead: 2 px --label line with an 8 px round head; never eased
  const px = X(t);
  if (px >= -4 && px <= w + 4) {
    ctx.fillStyle = pal.label;
    ctx.fillRect(Math.round(px) - 1, 2, 2, h - 2);
    ctx.beginPath();
    ctx.arc(Math.round(px), 5, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export const Timeline = memo(TimelineImpl);
