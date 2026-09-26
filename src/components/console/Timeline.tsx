"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cx } from "@/components/ui";
import type { ConsoleController } from "@/lib/console/controller";
import { formatCountdown, withAlpha } from "@/lib/console/format";
import { selectTimeDecis, useStageValue } from "@/lib/console/hooks";
import { CUE_KIND_COLORS, CUE_KIND_LABELS, SCENE_LABELS } from "@/lib/console/labels";
import { CUE_ACTIVE_WINDOW, sortedCues } from "@/lib/console/navigation";
import {
  clampView,
  followPlayhead,
  fullView,
  peaksForView,
  tickLabel,
  ticks,
  tickStep,
  timeToX,
  viewForZoom,
  xToTime,
  zoomAround,
  ZOOM_LEVELS,
  type TimeView,
} from "@/lib/console/timeline-geom";
import type { PlaybackMode } from "@/lib/stage/protocol";
import { formatTime, lineSpan } from "@/lib/timeline";
import type { AudioAnalysis, CueNote, LyricLine, Project, SectionDesign } from "@/lib/types";
import { readTokens, subscribeAppearance, tokenAlpha } from "@/lib/ui/canvas-tokens";
import { useRafLoop } from "./useRaf";

const RULER_H = 16;
const SECTION_TOP = 18;
const SECTION_H = 20;
const WAVE_TOP = SECTION_TOP + SECTION_H + 6;
const LYRIC_H = 8;
const LYRIC_GAP = 6;

interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  line: string;
  fg: string;
  muted: string;
  faint: string;
  accent: string;
  font: string;
  mono: string;
}

/** Design tokens read from the canvas itself (the console is a dark scope inside the page). */
function readPalette(el: HTMLElement): Palette {
  const t = readTokens(el, {
    bg: ["--surface", "#1c1c1e"],
    panel: ["--surface", "#1c1c1e"],
    panel2: ["--surface-2", "#2c2c2e"],
    line: ["--separator", "rgba(84,84,88,0.65)"],
    fg: ["--label", "#ffffff"],
    muted: ["--label-2", "rgba(235,235,245,0.6)"],
    faint: ["--label-2", "rgba(235,235,245,0.6)"],
    accent: ["--tint", "#0a84ff"],
    mono: ["--font-numeric", "ui-monospace, monospace"],
  });
  let font = "sans-serif";
  try {
    font = getComputedStyle(el).fontFamily || font;
  } catch {
    /* default */
  }
  return { ...t, font };
}

interface Hover {
  x: number;
  t: number;
  cue: number | null;
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
  const viewRef = useRef<TimeView>(fullView(duration));
  const [zoom, setZoom] = useState<number>(1);
  const hoverRef = useRef<Hover | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [wrapWidth, setWrapWidth] = useState(0);
  const pendingSeek = useRef<number | null>(null);
  const lastKey = useRef("");
  const t = useStageValue(controller.store, selectTimeDecis);
  const versionRef = useRef(0);

  const plan = project.plan;
  const analysis = project.analysis;
  const lines = useMemo(() => project.lyrics?.lines ?? [], [project.lyrics]);
  const cues = useMemo(() => sortedCues(plan), [plan]);
  const peaks = useMemo(() => (analysis?.peaks?.length ? analysis.peaks : fallbackPeaks ?? null), [analysis, fallbackPeaks]);
  const peaksDuration = analysis?.peaks?.length && analysis.duration > 0 ? analysis.duration : duration;
  const beats = analysis?.beats ?? [];

  // anything the static drawing depends on bumps the version so the next frame redraws
  useEffect(() => {
    versionRef.current++;
  }, [project, peaks, duration, mode]);

  useEffect(() => {
    viewRef.current = zoom === 1 ? fullView(duration) : clampView(viewRef.current, duration);
    versionRef.current++;
  }, [duration, zoom]);

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

  const applyZoom = useCallback(
    (next: number) => {
      const z = Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], Math.max(1, next));
      viewRef.current = z === 1 ? fullView(duration) : viewForZoom(z, controller.songTime(), duration);
      setZoom(z);
      versionRef.current++;
    },
    [controller, duration],
  );

  // wheel: ctrl/⌘ + wheel zooms around the cursor, plain wheel pans when zoomed
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const { w } = sizeRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const view = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const idx = ZOOM_LEVELS.findIndex((z) => z >= zoom);
        const nextIdx = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + (e.deltaY < 0 ? 1 : -1)));
        const z = ZOOM_LEVELS[nextIdx];
        const anchor = xToTime(x, view, w);
        viewRef.current = z === 1 ? fullView(duration) : zoomAround(view, view.span / (Math.max(duration, 1) / z), anchor, duration);
        setZoom(z);
        versionRef.current++;
        return;
      }
      if (zoom === 1) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      viewRef.current = clampView({ start: view.start + (delta / Math.max(1, w)) * view.span, span: view.span }, duration);
      versionRef.current++;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [duration, zoom]);

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
    return { x, t: xToTime(x, viewRef.current, sizeRef.current.w) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    dragRef.current = { pointerId: e.pointerId };
    setDragging(true);
    const { x, t } = pointerTime(e);
    const cue = cueAtX(x);
    controller.seek(cue != null && e.clientY - e.currentTarget.getBoundingClientRect().top < WAVE_TOP + 10 ? cues[cue].time : t);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, t } = pointerTime(e);
    const next: Hover = { x, t, cue: dragRef.current ? null : cueAtX(x) };
    hoverRef.current = next;
    setHover((prev) => (prev && prev.cue === next.cue && Math.abs(prev.x - next.x) < 0.5 ? prev : next));
    if (dragRef.current) pendingSeek.current = t;
  };

  const endDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    if (pendingSeek.current != null) controller.seek(pendingSeek.current);
    pendingSeek.current = null;
    dragRef.current = null;
    setDragging(false);
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const t = controller.songTime();
    let target: number | null = null;
    if (e.key === "PageUp") target = t - 5;
    else if (e.key === "PageDown") target = t + 5;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = Math.max(0, duration - 0.5);
    if (target == null) return;
    e.preventDefault();
    e.stopPropagation();
    controller.seek(target);
  };

  useRafLoop(() => {
    const canvas = canvasRef.current;
    const pal = paletteRef.current;
    if (!canvas || !pal) return;
    if (pendingSeek.current != null) {
      controller.seek(pendingSeek.current);
      pendingSeek.current = null;
    }
    const state = controller.store.get();
    const t = controller.songTime();
    if (state.playing && !dragRef.current) {
      const followed = followPlayhead(viewRef.current, t, duration);
      if (followed !== viewRef.current) viewRef.current = followed;
    }
    const view = viewRef.current;
    const { w, h, dpr } = sizeRef.current;
    const hv = hoverRef.current;
    const key = `${Math.round(t * 60)}|${view.start.toFixed(3)}|${view.span.toFixed(3)}|${w}|${h}|${dpr}|${hv ? `${hv.x.toFixed(1)}:${hv.cue}` : "-"}|${versionRef.current}|${state.lineIndex}|${state.sectionIndex}`;
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
      dragging: dragRef.current != null,
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

  const hoverCue: CueNote | null = hover?.cue != null ? (cues[hover.cue] ?? null) : null;

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel" style={{ gridArea: "timeline" }} aria-label="時間軸">
      <header className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold text-muted">時間軸</h2>
          <span className="hidden items-center gap-2 text-[11px] text-faint min-[1400px]:flex">
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm bg-accent" />
              歌詞
            </span>
            {(Object.keys(CUE_KIND_LABELS) as Array<CueNote["kind"]>)
              .filter((k) => cues.some((c) => c.kind === k))
              .map((k) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="size-2 rotate-45" style={{ background: CUE_KIND_COLORS[k] }} />
                  {CUE_KIND_LABELS[k]}
                </span>
              ))}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <span className="mr-1 font-mono text-faint tabular">×{zoom}</span>
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-30"
            onClick={() => applyZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]) - 1)])}
            disabled={zoom === 1}
            aria-label="縮小時間軸"
          >
            −
          </button>
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-30"
            onClick={() => applyZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]) + 1)])}
            disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            aria-label="放大時間軸"
          >
            +
          </button>
          <button
            type="button"
            className={cx("h-6 rounded px-1.5 text-muted hover:bg-panel-3 hover:text-fg", zoom === 1 && "text-faint")}
            onClick={() => applyZoom(1)}
          >
            全曲
          </button>
        </div>
      </header>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="slider"
          aria-label="播放位置（點擊或拖曳跳轉，Page Up／Down 前後 5 秒）"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(t)}
          aria-valuetext={formatTime(t)}
          className="absolute inset-0 cursor-pointer touch-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown}
        />
        {hover && !dragging && (
          <div
            className="pointer-events-none absolute top-0.5 z-10 rounded bg-bg/90 px-1.5 py-0.5 font-mono text-[11px] text-fg tabular ring-1 ring-line"
            style={{ left: Math.min(Math.max(0, hover.x + 6), Math.max(0, wrapWidth - 64)) }}
          >
            {formatTime(hover.t)}
          </div>
        )}
        {hoverCue && hover && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 w-64 rounded-md border border-line bg-panel-2/95 p-2.5 shadow-xl backdrop-blur"
            style={{ left: Math.min(Math.max(4, hover.x - 128), Math.max(4, wrapWidth - 260)), top: WAVE_TOP + 8 }}
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold" style={{ color: CUE_KIND_COLORS[hoverCue.kind] }}>
                {CUE_KIND_LABELS[hoverCue.kind] ?? hoverCue.kind}
              </span>
              <span className="font-mono text-faint tabular">
                {formatTime(hoverCue.time)} · {hoverCue.time < t - CUE_ACTIVE_WINDOW ? "已經過" : formatCountdown(hoverCue.time - t)}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold text-fg">{hoverCue.title}</p>
            {hoverCue.detail && <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{hoverCue.detail}</p>}
          </div>
        )}
      </div>
    </section>
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

  // ruler
  const step = tickStep(view, w);
  ctx.font = `500 11px ${pal.mono}`;
  ctx.textBaseline = "middle";
  for (const tick of ticks(view, step)) {
    const x = Math.round(X(tick)) + 0.5;
    ctx.fillStyle = pal.line;
    ctx.fillRect(x - 0.5, RULER_H - 5, 1, 5);
    ctx.fillStyle = tokenAlpha(pal.line, 0.35);
    ctx.fillRect(x - 0.5, WAVE_TOP, 1, waveBottom - WAVE_TOP);
    ctx.fillStyle = pal.faint;
    ctx.fillText(tickLabel(tick, step), x + 3, RULER_H / 2);
  }

  // sections
  ctx.font = `600 11px ${pal.font}`;
  sections.forEach((s, i) => {
    const x0 = Math.max(0, X(s.start));
    const x1 = Math.min(w, X(s.end));
    if (x1 <= 0 || x0 >= w || x1 - x0 < 1) return;
    const active = i === d.state.sectionIndex;
    const primary = s.colorway[1] ?? "#4455cc";
    const accent = s.colorway[2] ?? primary;
    ctx.fillStyle = withAlpha(primary, active ? 0.62 : 0.3);
    roundRect(ctx, x0 + 1, SECTION_TOP, x1 - x0 - 2, SECTION_H, 4);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(x0 + 1, SECTION_TOP, 2, SECTION_H);
    if (active) {
      ctx.strokeStyle = tokenAlpha(pal.fg, 0.7);
      ctx.lineWidth = 1;
      roundRect(ctx, x0 + 1.5, SECTION_TOP + 0.5, x1 - x0 - 3, SECTION_H - 1, 4);
      ctx.stroke();
    }
    const label = `${s.label}  ${SCENE_LABELS[s.scene] ?? ""}`;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + 6, SECTION_TOP, Math.max(0, x1 - x0 - 10), SECTION_H);
    ctx.clip();
    ctx.fillStyle = active ? pal.fg : tokenAlpha(pal.fg, 0.85);
    ctx.fillText(label, x0 + 8, SECTION_TOP + SECTION_H / 2 + 0.5);
    ctx.restore();
  });

  // beat grid (only when there is room for it)
  if (beats.length > 1) {
    const pxPerBeat = (w / view.span) * ((beats[beats.length - 1] - beats[0]) / (beats.length - 1));
    if (pxPerBeat >= 9) {
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        if (b < view.start || b > view.start + view.span) continue;
        ctx.fillStyle = tokenAlpha(pal.fg, i % 4 === 0 ? 0.1 : 0.045);
        ctx.fillRect(Math.round(X(b)), WAVE_TOP, 1, waveBottom - WAVE_TOP);
      }
    }
  }

  // waveform
  if (peaks && peaks.length > 0) {
    const cols = Math.max(1, Math.floor(w / 2));
    const colW = w / cols;
    const values = peaksForView(peaks, peaksDuration, view, cols);
    let si = 0;
    for (let c = 0; c < cols; c++) {
      const ct = view.start + ((c + 0.5) / cols) * view.span;
      while (si < sections.length - 1 && ct >= sections[si + 1].start) si++;
      const s = sections[si];
      const played = ct <= t;
      const base = s ? (s.colorway[2] ?? s.colorway[1] ?? pal.fg) : pal.fg;
      const amp = Math.max(0.6, values[c] * waveHalf);
      ctx.fillStyle = played ? withAlpha(base, 0.95) : withAlpha(s ? (s.colorway[1] ?? pal.fg) : pal.fg, 0.5);
      ctx.fillRect(c * colW, waveMid - amp, Math.max(1, colW - 0.6), amp * 2);
    }
  } else {
    ctx.fillStyle = tokenAlpha(pal.fg, 0.12);
    ctx.fillRect(0, waveMid - 0.5, w, 1);
    ctx.font = `500 11px ${pal.font}`;
    ctx.fillStyle = pal.faint;
    ctx.textAlign = "center";
    ctx.fillText(peaks ? "沒有波形資料" : "讀取波形中…", w / 2, waveMid - 10);
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
    ctx.strokeStyle = tokenAlpha(pal.fg, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // lyric spans
  for (let i = 0; i < lines.length; i++) {
    const span = lineSpan(lines, i, duration);
    if (!span) continue;
    const x0 = X(span[0]);
    const x1 = X(span[1]);
    if (x1 < 0 || x0 > w) continue;
    const current = i === d.state.lineIndex;
    ctx.fillStyle = current ? pal.accent : span[0] <= t ? tokenAlpha(pal.fg, 0.35) : tokenAlpha(pal.fg, 0.18);
    roundRect(ctx, x0, lyricY, Math.max(2, x1 - x0 - 1.5), LYRIC_H, 2);
    ctx.fill();
  }

  // cue markers
  cues.forEach((c, i) => {
    const x = X(c.time);
    if (x < -8 || x > w + 8) return;
    const color = CUE_KIND_COLORS[c.kind] ?? pal.fg;
    const hot = d.hover?.cue === i;
    ctx.fillStyle = withAlpha(color, hot ? 0.9 : 0.5);
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
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // hover
  if (d.hover && !d.dragging) {
    const x = Math.round(d.hover.x) + 0.5;
    ctx.fillStyle = tokenAlpha(pal.fg, 0.4);
    ctx.fillRect(x - 0.5, RULER_H, 1, h - RULER_H);
  }

  // playhead
  const px = X(t);
  if (px >= -2 && px <= w + 2) {
    ctx.fillStyle = pal.accent;
    ctx.fillRect(Math.round(px) - 1, 0, 2, h);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
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
