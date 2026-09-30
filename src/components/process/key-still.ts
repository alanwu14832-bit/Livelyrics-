"use client";

// 主視覺 (phase 7): the key still of a song — one frame of its scene program (with the lyric of that
// moment, in its composition) rendered by the export renderer (OfflineStage) at the program's key
// moment (the first chorus by default), in the output canvas' aspect at preview size. The render
// also says whether the program compiled on this computer (the page offers 「請 Claude 修正」).
// Cached client-side as object URLs (small LRU); queued with the style frames (one WebGL context).

import { useEffect, useState } from "react";
import { OfflineStage } from "@/components/stage/export/OfflineStage";
import { enqueueRender, frameSize } from "@/components/directions/style-frames";
import { keyMomentOf } from "@/lib/stage/program/model";
import type { Project } from "@/lib/types";

export interface KeyStill {
  url: string;
  width: number;
  height: number;
  t: number;
  /** the program on this renderer: ready, failed (with the log) or none */
  program: { state: "none" | "ready" | "failed"; log?: string };
}

const cache = new Map<string, KeyStill>();

function fnv(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function keyStillKey(project: Project): string {
  const { width, height } = frameSize(project);
  const lyrics = project.lyrics.lines.map((l) => `${l.id}:${l.start}:${l.text}`).join("|");
  return `${project.id}|${width}x${height}|${fnv(JSON.stringify(project.plan))}|${fnv(lyrics)}|${fnv(JSON.stringify(project.output?.safety ?? null))}`;
}

async function render(project: Project): Promise<KeyStill> {
  const plan = project.plan;
  if (!plan) throw new Error("沒有設計方案");
  const { width, height } = frameSize(project);
  const out = project.output;
  const staged: Project = { ...project, output: { ...out, width, height } };
  const t = keyMomentOf(plan, project.meta.duration || project.analysis?.duration || 0);
  const stage = new OfflineStage(staged);
  try {
    await stage.prepare();
    if (!stage.webgl) throw new Error(stage.error ?? "這台電腦無法使用 WebGL，無法算出畫面");
    const program = stage.program;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    await stage.renderFrame(t, 12, { scene: true, background: false, lyrics: true, matte: false });
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    stage.drawFull(ctx);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) throw new Error("無法輸出畫面");
    return { url: URL.createObjectURL(blob), width, height, t, program };
  } finally {
    stage.destroy();
  }
}

export function keyStill(project: Project): Promise<KeyStill> {
  const key = keyStillKey(project);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return enqueueRender(() => render(project)).then((still) => {
    cache.set(key, still);
    while (cache.size > 8) {
      const [k, old] = cache.entries().next().value as [string, KeyStill];
      cache.delete(k);
      URL.revokeObjectURL(old.url);
    }
    return still;
  });
}

export type KeyStillState = { status: "loading" } | { status: "ready"; still: KeyStill } | { status: "error"; error: string };

/** React: the key still of the project's current plan (rendered when the plan changes). */
export function useKeyStill(project: Project | null): KeyStillState {
  const key = project?.plan ? keyStillKey(project) : "";
  const [state, setState] = useState<{ key: string; value: KeyStillState } | null>(null);
  useEffect(() => {
    if (!project?.plan || cache.has(key)) return;
    let live = true;
    keyStill(project).then(
      (still) => live && setState({ key, value: { status: "ready", still } }),
      (err: unknown) => live && setState({ key, value: { status: "error", error: err instanceof Error ? err.message : String(err) } }),
    );
    return () => {
      live = false;
    };
    // the key covers everything the still depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const hit = key ? cache.get(key) : undefined;
  if (hit) return { status: "ready", still: hit };
  return state && state.key === key ? state.value : { status: "loading" };
}
