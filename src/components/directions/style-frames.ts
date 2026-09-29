"use client";

// Style frames (phase 4): the key stills of a design direction, rendered in the browser by the
// deterministic export renderer (OfflineStage: the real shaders, band media, lyric layer and
// fonts, with the project's LED 安全模式 applied) at preview resolution (960 px on the long edge,
// the output canvas' aspect). The moments come from styleFrameMoments (intro, first chorus with
// lyrics, bridge, final chorus).
//
// Caching: rendered frames are kept client-side as object URLs (JPEG), keyed by the direction's
// plan, the lyrics, the canvas and the safety settings, in a small in-memory LRU that survives
// client-side navigation (design overview ↔ 一頁提案). A reload renders them again on demand (a
// few seconds per direction). Nothing is uploaded, so local and cloud mode behave the same and no
// storage is used; renders run one at a time (one WebGL context).

import { useEffect, useState } from "react";
import { OfflineStage } from "@/components/stage/export/OfflineStage";
import { styleFrameMoments, type StyleFrameMoment } from "@/lib/directions";
import { DEFAULT_OUTPUT } from "@/lib/output";
import type { DesignDirection, Project } from "@/lib/types";

export const STYLE_FRAME_EDGE = 960;
const FPS = 12;
const MAX_CACHED = 12;

export interface StyleFrame extends StyleFrameMoment {
  /** object URL of the JPEG */
  url: string;
  width: number;
  height: number;
}

function fnv(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function frameSize(project: Pick<Project, "output">): { width: number; height: number } {
  const out = project.output && project.output.width > 0 && project.output.height > 0 ? project.output : DEFAULT_OUTPUT;
  const aspect = out.width / out.height;
  return aspect >= 1 ? { width: STYLE_FRAME_EDGE, height: Math.max(2, Math.round(STYLE_FRAME_EDGE / aspect / 2) * 2) } : { width: Math.max(2, Math.round((STYLE_FRAME_EDGE * aspect) / 2) * 2), height: STYLE_FRAME_EDGE };
}

export function frameKey(project: Project, direction: DesignDirection): string {
  const { width, height } = frameSize(project);
  const lyrics = project.lyrics.lines.map((l) => `${l.id}:${l.start}:${l.text}`).join("|");
  return `${project.id}|${direction.id}|${width}x${height}|${fnv(JSON.stringify(direction.plan))}|${fnv(lyrics)}|${fnv(JSON.stringify(project.output?.safety ?? null))}`;
}

const cache = new Map<string, StyleFrame[]>();
const pending = new Map<string, Promise<StyleFrame[]>>();
let queue: Promise<unknown> = Promise.resolve();

function remember(key: string, frames: StyleFrame[]) {
  cache.delete(key);
  cache.set(key, frames);
  while (cache.size > MAX_CACHED) {
    const [oldKey, old] = cache.entries().next().value as [string, StyleFrame[]];
    cache.delete(oldKey);
    for (const f of old) URL.revokeObjectURL(f.url);
  }
}

export function cachedFrames(project: Project, direction: DesignDirection): StyleFrame[] | null {
  return cache.get(frameKey(project, direction)) ?? null;
}

async function render(project: Project, direction: DesignDirection): Promise<StyleFrame[]> {
  const { width, height } = frameSize(project);
  const moments = styleFrameMoments(direction.plan, project.lyrics);
  const out = project.output && project.output.width > 0 ? project.output : DEFAULT_OUTPUT;
  // the same project (ids, media, lyrics, safety) with the direction's plan on a preview-size canvas
  const staged: Project = { ...project, plan: direction.plan, output: { ...out, width, height } };
  const stage = new OfflineStage(staged);
  try {
    await stage.prepare();
    if (!stage.webgl) throw new Error(stage.error ?? "這台電腦無法使用 WebGL，無法算出畫面");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const frames: StyleFrame[] = [];
    for (const m of moments) {
      await stage.renderFrame(m.t, FPS, { scene: true, background: false, lyrics: true, matte: false });
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      stage.drawFull(ctx);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
      if (!blob) throw new Error("無法輸出畫面");
      frames.push({ ...m, url: URL.createObjectURL(blob), width, height });
      // let the page breathe between frames
      await new Promise((r) => setTimeout(r, 0));
    }
    return frames;
  } finally {
    stage.destroy();
  }
}

/** The style frames of a direction (cached; renders are queued one at a time). */
export function styleFrames(project: Project, direction: DesignDirection): Promise<StyleFrame[]> {
  const key = frameKey(project, direction);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const job = queue.then(() => render(project, direction));
  queue = job.catch(() => {});
  const tracked = job.then(
    (frames) => {
      remember(key, frames);
      pending.delete(key);
      return frames;
    },
    (err) => {
      pending.delete(key);
      throw err;
    },
  );
  pending.set(key, tracked);
  return tracked;
}

export type FramesState = { status: "loading"; frames: null; error: null } | { status: "ready"; frames: StyleFrame[]; error: null } | { status: "error"; frames: null; error: string };

/** React: the frames of `direction`, rendered on demand. `retry` renders again. */
export function useStyleFrames(project: Project | null, direction: DesignDirection | null): FramesState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const key = project && direction ? frameKey(project, direction) : "";
  const [state, setState] = useState<{ key: string; attempt: number; value: FramesState } | null>(null);
  const hit = project && direction ? cachedFrames(project, direction) : null;
  useEffect(() => {
    if (!project || !direction || cachedFrames(project, direction)) return;
    let live = true;
    styleFrames(project, direction).then(
      (frames) => {
        if (live) setState({ key, attempt, value: { status: "ready", frames, error: null } });
      },
      (err: unknown) => {
        if (live) setState({ key, attempt, value: { status: "error", frames: null, error: err instanceof Error ? err.message : String(err) } });
      },
    );
    return () => {
      live = false;
    };
    // the key covers everything the frames depend on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const value: FramesState = hit
    ? { status: "ready", frames: hit, error: null }
    : state && state.key === key && state.attempt === attempt
      ? state.value
      : { status: "loading", frames: null, error: null };
  return { ...value, retry: () => setAttempt((n) => n + 1) };
}
