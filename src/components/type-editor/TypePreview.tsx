"use client";

// The 排版 editor's live preview: the real <StageView> (the projection's renderer, type pass and
// LED safety included) at the output canvas's aspect. Paused, it shows the selected line settled
// after its entrance; 「從這句播放」 plays the song from the line with the stage following the
// audio. With a fine pointer (mouse, pen) the composition is moved by dragging the preview; on a
// phone the editor's arrow pad does it.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { StageView } from "@/components/stage/StageView";
import { cx } from "@/components/ui";
import { api } from "@/lib/api-client";
import { DEFAULT_OUTPUT, outputAspect } from "@/lib/output";
import { createStageStore, initialStageState, type StageState } from "@/lib/stage/protocol";
import { lineIndexAt, lineSpan, sectionIndexAt, sectionIndexForLine } from "@/lib/timeline";
import type { Project } from "@/lib/types";

export interface PreviewHandle {
  play: () => void;
  stop: () => void;
}

/** Where a paused preview shows a line: after its entrance has settled, before it leaves. */
export function settleTime(project: Project, index: number): number | null {
  const lines = project.lyrics.lines;
  const span = lineSpan(lines, index, project.meta.duration);
  if (!span) return null;
  const [start, end] = span;
  return start + Math.min(1.8, Math.max(0.45, (end - start) * 0.62));
}

export function TypePreview({
  project,
  lineIndex,
  playing,
  onPlayingChange,
  onLineChange,
  nudge,
  onNudge,
  className,
}: {
  project: Project;
  /** the selected line (the paused preview shows it) */
  lineIndex: number | null;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  /** while playing: the line the song has reached */
  onLineChange?: (index: number | null) => void;
  /** the selected line's current nudge (fractions of the canvas) */
  nudge: { dx: number; dy: number };
  /** drag on the preview (fine pointers): the new nudge; `done` on release */
  onNudge?: (dx: number, dy: number, done: boolean) => void;
  className?: string;
}) {
  const [store] = useState(() => createStageStore(initialStageState(project.id)));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const projectRef = useRef(project);
  const lineRef = useRef(lineIndex);
  const reportRef = useRef(onLineChange);
  useEffect(() => {
    projectRef.current = project;
    lineRef.current = lineIndex;
    reportRef.current = onLineChange;
  }, [project, lineIndex, onLineChange]);

  // paused: the selected line, settled
  const showLine = useCallback(
    (index: number | null) => {
      const p = projectRef.current;
      const now = Date.now();
      const prev = store.get();
      const t = index != null ? (settleTime(p, index) ?? prev.t) : prev.t;
      const next: StageState = {
        ...prev,
        projectId: p.id,
        mode: "track",
        t,
        playing: false,
        sentAt: now,
        lineIndex: index,
        // untimed lines enter from their cue: show them settled too
        lineStartedAt: index !== prev.lineIndex || prev.playing ? now - 1800 : prev.lineStartedAt,
        sectionIndex: index != null ? sectionIndexForLine(p.plan, p.lyrics.lines, index, p.meta.duration) : sectionIndexAt(p.plan, t),
      };
      store.set(next);
    },
    [store],
  );

  useEffect(() => {
    if (!playing) showLine(lineIndex);
  }, [lineIndex, playing, project, showLine]);

  // playing: the stage follows the audio
  useEffect(() => {
    if (!playing) return;
    const audio = audioRef.current;
    const p = projectRef.current;
    const idx = lineRef.current;
    const start = idx != null ? (lineSpan(p.lyrics.lines, idx, p.meta.duration)?.[0] ?? 0) : 0;
    let raf = 0;
    let lastLine: number | null = idx;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const pp = projectRef.current;
      const t = audio ? audio.currentTime : 0;
      const li = lineIndexAt(pp.lyrics, t, pp.meta.duration);
      const prev = store.get();
      const now = Date.now();
      store.set({
        ...prev,
        projectId: pp.id,
        mode: "track",
        t,
        playing: true,
        sentAt: now,
        lineIndex: li,
        lineStartedAt: li !== prev.lineIndex ? now : prev.lineStartedAt,
        sectionIndex: sectionIndexAt(pp.plan, t),
      });
      if (li !== lastLine) {
        lastLine = li;
        reportRef.current?.(li);
      }
      raf = requestAnimationFrame(tick);
    };
    if (audio) {
      try {
        audio.currentTime = Math.max(0, start - 0.4);
      } catch {
        /* not seekable yet */
      }
      audio.play().catch(() => onPlayingChange(false));
      const ended = () => onPlayingChange(false);
      audio.addEventListener("ended", ended);
      raf = requestAnimationFrame(tick);
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
        audio.removeEventListener("ended", ended);
        audio.pause();
      };
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [playing, store, onPlayingChange]);

  // drag to move the composition (fine pointers only: on a phone the page scrolls)
  const drag = useRef<{ id: number; x: number; y: number; w: number; h: number; dx: number; dy: number; moved: boolean } | null>(null);
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: fine)");
    const update = () => setFine(!!mq?.matches);
    update();
    mq?.addEventListener?.("change", update);
    return () => mq?.removeEventListener?.("change", update);
  }, []);
  const canDrag = fine && !!onNudge && lineIndex != null && !playing;
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDrag || e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, w: r.width, h: r.height, dx: nudge.dx, dy: nudge.dy, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = (e.clientX - d.x) / Math.max(1, d.w);
    const my = (e.clientY - d.y) / Math.max(1, d.h);
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
    d.moved = true;
    onNudge?.(d.dx + mx, d.dy + my, false);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) onNudge?.(d.dx + (e.clientX - d.x) / Math.max(1, d.w), d.dy + (e.clientY - d.y) / Math.max(1, d.h), true);
  };

  const output = project.output ?? DEFAULT_OUTPUT;
  const aspect = Math.min(4, Math.max(0.3, outputAspect(output)));
  const audioUrl = useMemo(() => api.audioUrl(project.id), [project.id]);

  return (
    <div className={cx("relative flex min-h-0 w-full items-center justify-center", className)} style={{ containerType: "size" }}>
      <div
        className="relative overflow-hidden rounded-md bg-black shadow-[0_0_0_var(--hairline)_var(--separator)]"
        style={{ width: `min(100cqw, calc(100cqh * ${aspect}))`, aspectRatio: String(aspect) }}
        data-testid="type-preview"
      >
        <StageView project={project} store={store} className="absolute inset-0" style={{ aspectRatio: "auto", width: "100%", height: "100%" }} renderScale={0.85} />
        <div
          className={cx("absolute inset-0", canDrag && "cursor-move touch-none")}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden="true"
          data-testid="type-preview-drag"
        />
      </div>
      <audio ref={audioRef} src={audioUrl} crossOrigin="anonymous" preload="none" className="hidden" />
    </div>
  );
}
